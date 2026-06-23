import { getDb } from './db';
import { editableBooking } from './tripEditor';
import { listTrips } from './content';

// Shared registrations view-model. Both the registrations listing (trip cards)
// and the per-trip detail page derive their data from here so the "what counts
// as active vs. history" rules live in exactly one place.

export type Reg = Record<string, any>;

export interface RegDeparture {
  id: string;
  startDate: string;
  endDate: string;
  status: string;
  regs: Reg[];
  cap: number | null;
  booked: number;
  soldOut: boolean;
  historical: boolean;
}

export interface RegTrip {
  slug: string;
  name: string;
  active: boolean;
  nextDate: string;
  departures: RegDeparture[];
  historical: boolean;
  regCount: number;
}

export interface RegStats {
  lead: number;
  pending: number;
  confirmed: number;
  rejected: number;
}

export interface RegistrationsView {
  registrations: Reg[];
  trips: RegTrip[];
  legacyRegs: Reg[];
  total: number;
  totals: RegStats;
  revenue: number;
  historyCount: number;
}

const ACTIVE_STATUSES = ['booking-open', 'booking_open', 'filling-fast', 'filling_fast', 'upcoming'];

export function regStats(rs: Reg[]): RegStats {
  return {
    lead: rs.filter((r) => r.status === 'lead').length,
    pending: rs.filter((r) => r.status === 'pending').length,
    confirmed: rs.filter((r) => r.status === 'confirmed').length,
    rejected: rs.filter((r) => r.status === 'rejected').length,
  };
}

export function buildRegistrationsView(adminUser: any): RegistrationsView {
  const isTripLead = adminUser?.role === 'trip_lead';
  const allowedBatchIds: string[] | null = isTripLead ? (adminUser?.tripIds ?? []) : null;

  const registrations = (allowedBatchIds === null
    ? getDb().prepare('SELECT * FROM registrations ORDER BY id DESC').all()
    : allowedBatchIds.length
      ? getDb()
          .prepare(`SELECT * FROM registrations WHERE batch_id IN (${allowedBatchIds.map(() => '?').join(',')}) ORDER BY id DESC`)
          .all(...allowedBatchIds)
      : []) as Reg[];

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const knownBatchIds = new Set<string>();
  const regsByBatch = new Map<string, Reg[]>();
  for (const r of registrations)
    if (r.batch_id) {
      const a = regsByBatch.get(r.batch_id) ?? [];
      a.push(r);
      regsByBatch.set(r.batch_id, a);
    }

  const trips: RegTrip[] = listTrips()
    .map((trip: any) => {
      const name = String(trip.title || trip.name || trip.slug);
      const { editorDepartures } = editableBooking(trip);
      const departures: RegDeparture[] = editorDepartures
        .filter((d: any) => d.id && (!isTripLead || allowedBatchIds!.includes(String(d.id))))
        .map((d: any) => {
          const id = String(d.id);
          knownBatchIds.add(id);
          const offers = Array.isArray(d.offers) ? d.offers : [];
          const metered = offers.length > 0 && offers.every((o: any) => o.cap != null);
          const cap = metered ? offers.reduce((n: number, o: any) => n + Number(o.cap || 0), 0) : null;
          const booked = offers.reduce((n: number, o: any) => n + Number(o.booked || 0), 0);
          const soldOut = d.status === 'sold-out' || d.status === 'sold_out' || (cap !== null && booked >= cap);
          const start = new Date(d.startDate);
          start.setHours(0, 0, 0, 0);
          const historical = !d.startDate || start < today || d.status === 'completed' || d.status === 'draft' || soldOut;
          return {
            id,
            startDate: String(d.startDate || ''),
            endDate: String(d.endDate || d.startDate || ''),
            status: String(d.status || 'booking-open'),
            regs: regsByBatch.get(id) ?? [],
            cap,
            booked,
            soldOut,
            historical,
          };
        })
        .sort((a, b) => a.startDate.localeCompare(b.startDate));

      const activeDeps = departures.filter(
        (d) =>
          trip.registrationEnabled !== false &&
          !d.historical &&
          ACTIVE_STATUSES.includes(d.status) &&
          !d.soldOut &&
          (d.cap === null || d.booked < d.cap),
      );
      const regCount = departures.reduce((n, d) => n + d.regs.length, 0);
      return {
        slug: String(trip.slug),
        name,
        active: activeDeps.length > 0,
        nextDate: activeDeps[0]?.startDate ?? departures[0]?.startDate ?? '9999',
        departures,
        historical: activeDeps.length === 0,
        regCount,
      };
    })
    .filter((t) => t.departures.length > 0)
    .sort(
      (a, b) =>
        Number(b.active) - Number(a.active) || a.nextDate.localeCompare(b.nextDate) || a.name.localeCompare(b.name),
    );

  const legacyRegs = registrations.filter((r) => !r.batch_id || !knownBatchIds.has(String(r.batch_id)));
  const total = registrations.length;
  const totals = regStats(registrations);
  const revenue = registrations
    .filter((r) => r.status !== 'rejected')
    .reduce((n, r) => n + Number(r.amount_paid || 0), 0);
  const historyCount =
    trips.reduce((n, t) => n + t.departures.filter((d) => d.historical).length, 0) + (legacyRegs.length ? 1 : 0);

  return { registrations, trips, legacyRegs, total, totals, revenue, historyCount };
}
