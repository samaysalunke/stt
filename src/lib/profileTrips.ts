import { isTripPublic, readTrip } from './content';
import { derivePaymentStatus, paymentStatusLabel } from './registrationStatus';

export const PROFILE_STATUSES = ['wishlist', 'lead', 'pending', 'confirmed', 'cancelled', 'rejected'] as const;
export type ProfileStatus = (typeof PROFILE_STATUSES)[number];
export type TripPeriod = 'ongoing' | 'upcoming' | 'completed' | 'unresolved';

export interface ProfileRegistrationRow {
  id: number;
  trip_name: string;
  trip_slug: string | null;
  trip_date: string | null;
  batch_id: string | null;
  status: string;
  created_at: string | null;
  updated_at: string | null;
  status_changed_at: string | null;
  email?: string | null;
  full_name?: string | null;
  phone?: string | null;
  age?: string | null;
  date_of_birth?: string | null;
  gender?: string | null;
  city?: string | null;
  state?: string | null;
  instagram?: string | null;
  emergency_name?: string | null;
  emergency_phone?: string | null;
  emergency_relationship?: string | null;
  why_join?: string | null;
  sharing_option?: string | null;
  tier_id?: string | null;
  total_amount?: number | null;
  amount_paid?: number | null;
  amount_refunded?: number | null;
  payment_status?: string | null;
}

export interface ProfileTripRecord {
  id: number;
  tripName: string;
  tripSlug: string | null;
  batchId: string | null;
  tripExists: boolean;
  startDate: string | null;
  endDate: string | null;
  dateLabel: string;
  period: TripPeriod;
  status: ProfileStatus;
  statusLabel: string;
  paymentStatus: string;
  paymentLabel: string;
  bookable: boolean;
  location: string | null;
  changedAt: number;
  details: {
    occupancy: string | null;
    totalAmount: number | null;
    amountPaid: number;
    balance: number | null;
    amountRefunded: number;
    traveller: {
      name: string | null;
      phone: string | null;
      age: string | null;
      gender: string | null;
      cityState: string | null;
      instagram: string | null;
      emergencyContact: string | null;
      whyJoin: string | null;
    };
  };
}

export const travellerStatusLabel: Record<ProfileStatus, string> = {
  lead: 'Registration started',
  pending: 'Payment under review',
  confirmed: 'Confirmed',
  wishlist: 'Wishlisted',
  cancelled: 'Cancelled',
  rejected: 'Not confirmed',
};

const TERMINAL = new Set(['cancelled', 'rejected']);
const ACTIVE_PRIORITY: Record<string, number> = { confirmed: 4, pending: 3, lead: 2, wishlist: 1 };

function timestamp(row: ProfileRegistrationRow): number {
  const raw = row.status_changed_at || row.updated_at || row.created_at || '';
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parsedTime(value: string | null): number {
  const parsed = Date.parse(value ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareRecency(a: ProfileRegistrationRow, b: ProfileRegistrationRow): number {
  return parsedTime(b.status_changed_at) - parsedTime(a.status_changed_at) ||
    parsedTime(b.updated_at) - parsedTime(a.updated_at) ||
    parsedTime(b.created_at) - parsedTime(a.created_at) || b.id - a.id;
}

/** Return a YYYY-MM-DD without allowing UTC conversion to move the calendar day. */
export function indiaDateOnly(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const raw = value.trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(parsed);
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function todayInIndia(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function formatDateRange(start: string | null, end: string | null, fallback: string | null): string {
  if (!start) return fallback?.trim() || 'Dates to be confirmed';
  const fmt = (value: string) => new Intl.DateTimeFormat('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
  }).format(new Date(`${value}T12:00:00+05:30`));
  return end && end !== start ? `${fmt(start)} – ${fmt(end)}` : fmt(start);
}

function safeTrip(slug: string | null): Record<string, any> | null {
  if (!slug) return null;
  try { return readTrip(slug); } catch { return null; }
}

function resolved(row: ProfileRegistrationRow, today: string): ProfileTripRecord {
  const trip = safeTrip(row.trip_slug);
  const batch = Array.isArray(trip?.batches)
    ? trip.batches.find((candidate: any) => String(candidate?.id) === String(row.batch_id))
    : null;
  const storedDate = indiaDateOnly(row.trip_date);
  const fallbackDate = indiaDateOnly(row.created_at);
  const startDate = indiaDateOnly(batch?.startDate) ?? storedDate ?? fallbackDate;
  const endDate = indiaDateOnly(batch?.endDate) ?? startDate;
  let period: TripPeriod = 'unresolved';
  if (startDate && endDate) period = endDate < today ? 'completed' : startDate <= today ? 'ongoing' : 'upcoming';

  const rawStatus = PROFILE_STATUSES.includes(row.status as ProfileStatus)
    ? row.status as ProfileStatus : 'lead';
  const storedPayment = String(row.payment_status ?? '');
  const paymentStatus = ['unpaid', 'advance_paid', 'fully_paid', 'partial_refund', 'full_refund'].includes(storedPayment)
    ? storedPayment
    : derivePaymentStatus(row);
  const total = Number.isFinite(Number(row.total_amount)) && Number(row.total_amount) > 0 ? Number(row.total_amount) : null;
  const paid = Math.max(0, Number(row.amount_paid) || 0);
  const refunded = Math.max(0, Number(row.amount_refunded) || 0);
  const cityState = [row.city, row.state].map((v) => v?.trim()).filter(Boolean).join(', ') || null;
  const emergency = [row.emergency_name, row.emergency_phone, row.emergency_relationship]
    .map((v) => v?.trim()).filter(Boolean).join(' · ') || null;
  const batchStatus = String(batch?.status ?? '').toLowerCase();
  const bookable = Boolean(trip && isTripPublic({ ...trip, slug: row.trip_slug })) &&
    period === 'upcoming' && !['sold-out', 'draft', 'completed', 'coming-soon'].includes(batchStatus);

  return {
    id: row.id,
    tripName: row.trip_name,
    tripSlug: row.trip_slug,
    batchId: row.batch_id,
    tripExists: Boolean(trip && isTripPublic({ ...trip, slug: row.trip_slug })),
    startDate, endDate,
    dateLabel: formatDateRange(startDate, endDate, row.trip_date),
    period,
    status: rawStatus,
    statusLabel: travellerStatusLabel[rawStatus],
    paymentStatus,
    paymentLabel: paymentStatusLabel(paymentStatus),
    bookable,
    location: typeof trip?.location === 'string' && trip.location.trim() ? trip.location.trim() : null,
    changedAt: timestamp(row),
    details: {
      occupancy: row.sharing_option?.trim() || row.tier_id?.trim() || null,
      totalAmount: total,
      amountPaid: paid,
      balance: total == null ? null : Math.max(0, total - paid),
      amountRefunded: refunded,
      traveller: {
        name: row.full_name?.trim() || null,
        phone: row.phone?.trim() || null,
        age: row.age?.trim() || null,
        gender: row.gender?.trim() || null,
        cityState,
        instagram: row.instagram?.trim() || null,
        emergencyContact: emergency,
        whyJoin: row.why_join?.trim() || null,
      },
    },
  };
}

function canonicalKey(row: ProfileRegistrationRow): string {
  const email = String(row.email ?? '').trim().toLowerCase();
  const trip = (row.trip_slug || row.trip_name).trim().toLowerCase();
  const loaded = safeTrip(row.trip_slug);
  const batch = Array.isArray(loaded?.batches)
    ? loaded.batches.find((candidate: any) => String(candidate?.id) === String(row.batch_id)) : null;
  const departure = indiaDateOnly(batch?.startDate) || indiaDateOnly(row.trip_date) || row.batch_id || 'unknown';
  return `${email}|${trip}|${departure}`;
}

/** Presentation-only duplicate collapse. Registration history remains untouched. */
export function canonicalizeProfileTrips(rows: ProfileRegistrationRow[], today = todayInIndia()): ProfileTripRecord[] {
  const groups = new Map<string, ProfileRegistrationRow[]>();
  for (const row of rows) {
    const key = canonicalKey(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()].map((records) => {
    const active = records.filter((r) => !TERMINAL.has(r.status));
    const terminal = records.filter((r) => TERMINAL.has(r.status)).sort(compareRecency);
    const newestActiveTime = Math.max(-1, ...active.map(timestamp));
    let chosen: ProfileRegistrationRow;
    if (terminal[0] && timestamp(terminal[0]) > newestActiveTime) chosen = terminal[0];
    else chosen = active.sort((a, b) =>
      (ACTIVE_PRIORITY[b.status] ?? 0) - (ACTIVE_PRIORITY[a.status] ?? 0) ||
      compareRecency(a, b)
    )[0] ?? terminal[0];
    return resolved(chosen, today);
  });
}

export function groupProfileTrips(records: ProfileTripRecord[]) {
  const wishlist = records.filter((r) => r.status === 'wishlist');
  const history = records.filter((r) => TERMINAL.has(r.status) || r.period === 'completed');
  const active = records.filter((r) => r.status !== 'wishlist' && !TERMINAL.has(r.status) && r.period !== 'completed');
  active.sort((a, b) => (a.period === 'ongoing' ? -1 : 0) - (b.period === 'ongoing' ? -1 : 0) ||
    (a.startDate ?? '9999').localeCompare(b.startDate ?? '9999') || b.changedAt - a.changedAt);
  wishlist.sort((a, b) => (a.startDate ?? '9999').localeCompare(b.startDate ?? '9999') || b.changedAt - a.changedAt);
  history.sort((a, b) => (b.endDate ?? '').localeCompare(a.endDate ?? '') || b.changedAt - a.changedAt);
  return { active, wishlist, history };
}

export interface PublicProfileTrip {
  tripName: string;
  location: string | null;
  status: 'ongoing' | 'upcoming' | 'completed';
  tripSlug: string | null;
  startDate: string | null;
}

/** Explicit allow-list: this object is the only registration data public pages receive. */
export function shapePublicTrips(records: ProfileTripRecord[]): PublicProfileTrip[] {
  return records
    .filter((record) => record.status === 'confirmed')
    .map((record) => ({
      tripName: record.tripName,
      location: record.location,
      status: record.period === 'ongoing' ? 'ongoing' : record.period === 'upcoming' ? 'upcoming' : 'completed',
      tripSlug: record.tripExists ? record.tripSlug : null,
      startDate: record.startDate,
    }));
}
