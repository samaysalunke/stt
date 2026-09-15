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
  tierOptions: Array<{ tierId: string; label: string; price: number; cap: number | null; booked: number }>;
  /** true when the raw batch carries a real per-tier `offers[]` array (vs legacy
   *  `sharingOptions` synthesis, which copies the batch total onto every tier). */
  perTierOffers: boolean;
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
  wishlist: number;
  lead: number;
  pending: number;
  confirmed: number;
  rejected: number;
  cancelled: number;
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

const ACTIVE_STATUSES = ['booking-open', 'booking_open', 'filling-fast', 'filling_fast', 'coming-soon', 'coming_soon', 'upcoming'];

export function regStats(rs: Reg[]): RegStats {
  return {
    wishlist: rs.filter((r) => r.status === 'wishlist').length,
    lead: rs.filter((r) => r.status === 'lead').length,
    pending: rs.filter((r) => r.status === 'pending').length,
    confirmed: rs.filter((r) => r.status === 'confirmed').length,
    rejected: rs.filter((r) => r.status === 'rejected').length,
    cancelled: rs.filter((r) => r.status === 'cancelled').length,
  };
}

/** Statuses that never count toward collected revenue. Mirrors the rule in
 *  buildRegistrationsView() and the per-departure stats on the trip page. */
export const NON_REVENUE_STATUSES = ['rejected', 'wishlist', 'cancelled'];

export interface RegTally extends RegStats {
  count: number;
  revenue: number;
}

/** Sentinel select value for "row carries no attribution". */
export const UNATTRIBUTED = '__none__';

/**
 * Attribution accessors, shared so the row `data-*` attributes written by
 * RegistrationCard and the filter options built on the trip page normalise
 * values identically — a mismatch here silently yields a filter that matches
 * nothing.
 */

/** The stored first touch, or null when the row predates attribution or the
 *  blob is malformed. The only place first_touch_json is parsed. */
function firstTouch(r: Reg): Record<string, any> | null {
  try {
    return typeof r.first_touch_json === 'string' ? JSON.parse(r.first_touch_json) : null;
  } catch {
    return null;
  }
}

const norm = (value: unknown) => String(value ?? '').trim().toLowerCase();

/** Reader for one camelCase key of the stored first touch. */
const touchReader = (touchKey: string) => (r: Reg) => norm(firstTouch(r)?.[touchKey]);

/**
 * `source` is the DERIVED channel written by attributionSource() at registration
 * time — utm_source, else the referrer hostname, else 'direct' — and
 * createRegistration() hardcodes 'admin' for admin-created and admin-imported
 * rows. It is therefore almost never empty, and it is NOT the raw utm_source of
 * the first touch: a row can read source='google.com' with an empty utmSource
 * because the value came from the referrer. Both ship as separate filters for
 * exactly that reason — collapsing them would make "which rows carry no
 * utm_source" unaskable.
 */
export function regSource(r: Reg): string {
  return norm(r.source);
}

/** First-touch campaign. Reporting is first-touch by construction: register.ts
 *  COALESCEs first_touch_json so a later campaign never rewrites it. */
export const regCampaign = touchReader('utmCampaign');

export interface AttributionField {
  /** Stable id — the filter control's id suffix. */
  key: string;
  /**
   * The row's attribute name, without the `data-` prefix. Kebab-case because
   * HTML lowercases attribute names: `data-attr-utmMedium` comes back as
   * `data-attr-utmmedium`, which no camelCase lookup would ever find.
   */
  dataAttr: string;
  /** Query-string parameter. `source` and `campaign` keep the names they
   *  shipped with, so existing export links and bookmarks keep working. */
  param: string;
  label: string;
  /** "All …" option, exact fields only. */
  allLabel?: string;
  /** The UNATTRIBUTED bucket's wording, exact fields only. */
  noneLabel?: string;
  /**
   * `exact` renders a <select> built from the rows on screen and offers the
   * UNATTRIBUTED bucket; `contains` renders a free-text input matched as a
   * substring. Pinned per field rather than inferred from cardinality: the CSV
   * export never sees the rendered page, so a render-time choice would let the
   * download and the screen disagree about the same filter.
   */
  match: 'exact' | 'contains';
  /** SQL yielding exactly what `read` yields, for the export's WHERE clause. */
  sqlExpr: string;
  read: (r: Reg) => string;
}

/** json_extract() THROWS on a malformed blob (and on an empty string), which
 *  would 500 the whole export for one bad row — hence the json_valid() guard.
 *  trim(lower()) mirrors norm(), so SQL and JS cannot disagree on whitespace. */
const touchSql = (touchKey: string) =>
  `trim(lower(COALESCE(CASE WHEN json_valid(first_touch_json) THEN json_extract(first_touch_json, '$.${touchKey}') END, '')))`;

/** `utmMedium` -> `attr-utm-medium`. */
const dataAttrFor = (key: string) => `attr-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

const touchField = (
  f: Omit<AttributionField, 'sqlExpr' | 'read' | 'dataAttr'> & { touchKey: string },
): AttributionField => ({
  key: f.key, dataAttr: dataAttrFor(f.key), param: f.param, label: f.label,
  allLabel: f.allLabel, noneLabel: f.noneLabel, match: f.match,
  sqlExpr: touchSql(f.touchKey), read: touchReader(f.touchKey),
});

/** The one list the row data attributes, the filter panel, the client matcher
 *  and the export SQL all read from. Add a dimension here and nowhere else. */
export const ATTRIBUTION_FIELDS: readonly AttributionField[] = [
  {
    key: 'source', dataAttr: 'attr-source', param: 'source', label: 'Channel (derived)',
    allLabel: 'All channels', noneLabel: '(not attributed)', match: 'exact',
    sqlExpr: "trim(lower(COALESCE(source, '')))", read: regSource,
  },
  touchField({ key: 'utmSource', param: 'utm_source', label: 'UTM source', allLabel: 'All utm_source', noneLabel: '(no utm_source)', match: 'exact', touchKey: 'utmSource' }),
  touchField({ key: 'utmMedium', param: 'utm_medium', label: 'UTM medium', allLabel: 'All utm_medium', noneLabel: '(no utm_medium)', match: 'exact', touchKey: 'utmMedium' }),
  touchField({ key: 'campaign', param: 'campaign', label: 'Campaign', allLabel: 'All campaigns', noneLabel: '(no campaign)', match: 'exact', touchKey: 'utmCampaign' }),
  // Free text by nature — full URLs and per-ad content values, where a dropdown
  // would be one option per row.
  touchField({ key: 'utmContent', param: 'utm_content', label: 'UTM content', match: 'contains', touchKey: 'utmContent' }),
  touchField({ key: 'utmTerm', param: 'utm_term', label: 'UTM term', match: 'contains', touchKey: 'utmTerm' }),
  touchField({ key: 'landingPage', param: 'landing_page', label: 'Landing page', match: 'contains', touchKey: 'landingPage' }),
  touchField({ key: 'referrer', param: 'referrer', label: 'Referrer', match: 'contains', touchKey: 'referrer' }),
];

/** Sorted distinct non-empty values, for building a filter's <option> list. */
export function distinctValues(regs: Reg[], pick: (r: Reg) => string): string[] {
  return [...new Set(regs.map(pick).filter(Boolean))].sort();
}

export interface AttributionFilterModel {
  field: AttributionField;
  options: string[];
  hasNone: boolean;
  /** Whether the control is worth rendering for these rows at all. */
  show: boolean;
}

/**
 * Per-field filter state for the rows on screen. An exact filter earns its
 * dropdown only when it can actually split those rows; a contains filter earns
 * its input when there is anything to search. Without this a direct-traffic-only
 * trip would show eight useless controls.
 */
export function attributionFilterModels(regs: Reg[]): AttributionFilterModel[] {
  return ATTRIBUTION_FIELDS.map((field) => {
    const options = distinctValues(regs, field.read);
    const hasNone = regs.some((r) => !field.read(r));
    const show = field.match === 'exact'
      ? options.length > 1 || (options.length === 1 && hasNone)
      : options.length > 0;
    return { field, options, hasNone, show };
  });
}

export interface ClientAttributionField {
  key: string;
  dataAttr: string;
  param: string;
  match: 'exact' | 'contains';
}

/** JSON-safe projection for `define:vars`, which serialises with JSON.stringify
 *  and would silently drop `read` and leave the client calling undefined. */
export function clientAttributionFields(): ClientAttributionField[] {
  return ATTRIBUTION_FIELDS.map(({ key, dataAttr, param, match }) => ({ key, dataAttr, param, match }));
}

/**
 * The at-a-glance attribution shown on a collapsed booking row: "channel/medium
 * · campaign". Admin-created and imported rows read 'admin' rather than "not
 * attributed" — they ARE attributed, to manual entry — so only a genuinely
 * empty row falls back.
 */
export function attributionChip(r: Reg): { label: string; title: string; attributed: boolean } {
  const touch = firstTouch(r);
  const source = regSource(r);
  const medium = norm(touch?.utmMedium);
  const campaign = norm(touch?.utmCampaign);
  const channel = [source, medium].filter(Boolean).join('/');
  const label = [channel, campaign].filter(Boolean).join(' · ');
  const detail = ATTRIBUTION_FIELDS
    .map((f) => { const v = f.read(r); return v ? `${f.label}: ${v}` : ''; })
    .filter(Boolean)
    .join('\n');
  return {
    label: label || 'not attributed',
    title: detail || 'No attribution captured for this booking',
    attributed: Boolean(label),
  };
}

/**
 * Stats over an arbitrary subset of rows, in the shape the trip page's
 * updateStats() consumes. Used to recompute the stat cards from whichever rows
 * a filter leaves visible, so "campaign = diwali-ig" reports that campaign's
 * own registrations, leads, confirmed count and revenue.
 */
export function tallyRegs(rows: Array<{ status: string; amount_paid?: unknown }>): RegTally {
  const stats = regStats(rows as Reg[]);
  return {
    ...stats,
    count: rows.length,
    revenue: rows
      .filter((r) => !NON_REVENUE_STATUSES.includes(r.status))
      .reduce((n, r) => n + (Number(r.amount_paid) || 0), 0),
  };
}

/**
 * History is chronological, not an availability state. A future departure can
 * be sold out while its registrations still need day-to-day administration.
 */
export function isHistoricalDeparture(
  departure: Pick<RegDeparture, 'startDate' | 'status'>,
  today = new Date(),
): boolean {
  if (!departure.startDate) return true;
  const start = new Date(departure.startDate);
  start.setHours(0, 0, 0, 0);
  const day = new Date(today);
  day.setHours(0, 0, 0, 0);
  return start < day || departure.status === 'completed' || departure.status === 'draft';
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

  // Attach accounting metadata without exposing OAuth credentials or persisted
  // billing snapshots to the browser.
  if (registrations.length) {
    const ids = registrations.map((r) => Number(r.id));
    const documents = getDb().prepare(`
      SELECT id, registration_id, document_type, mode, status, zoho_document_id,
             zoho_document_number, zoho_status, attempts, last_error, issued_at,
             sent_at, updated_at
      FROM invoice_documents
      WHERE registration_id IN (${ids.map(() => '?').join(',')})
      ORDER BY created_at
    `).all(...ids) as any[];
    const byRegistration = new Map<number, any[]>();
    for (const document of documents) {
      const list = byRegistration.get(Number(document.registration_id)) || [];
      list.push(document);
      byRegistration.set(Number(document.registration_id), list);
    }
    for (const registration of registrations) registration.accounting_documents = byRegistration.get(Number(registration.id)) || [];
  }

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
      const { editorCatalog, editorDepartures } = editableBooking(trip);
      const labelByTier = Object.fromEntries(editorCatalog.map((c) => [c.id, c.label]));
      const departures: RegDeparture[] = editorDepartures
        .filter((d: any) => d.id && (!isTripLead || allowedBatchIds!.includes(String(d.id))))
        .map((d: any) => {
          const id = String(d.id);
          knownBatchIds.add(id);
          const rawBatch = (Array.isArray(trip.batches) ? trip.batches : []).find((b: any) => String(b?.id) === id);
          const perTierOffers = Array.isArray(rawBatch?.offers) && rawBatch.offers.length > 0;
          const offers = Array.isArray(d.offers) ? d.offers : [];
          const metered = offers.length > 0 && offers.every((o: any) => o.cap != null);
          const cap = metered ? offers.reduce((n: number, o: any) => n + Number(o.cap || 0), 0) : null;
          const booked = offers.reduce((n: number, o: any) => n + Number(o.booked || 0), 0);
          const soldOut = d.status === 'sold-out' || d.status === 'sold_out' || (cap !== null && booked >= cap);
          const historical = isHistoricalDeparture(
            { startDate: String(d.startDate || ''), status: String(d.status || 'booking-open') },
            today,
          );
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
            perTierOffers,
            tierOptions: offers.map((o: any) => ({
              tierId: String(o.tierId),
              label: labelByTier[String(o.tierId)] ?? String(o.tierId),
              price: Number(o.price) || 0,
              cap: o.cap != null ? Number(o.cap) : null,
              booked: Number(o.booked) || 0,
            })),
          };
        })
        .sort((a, b) => a.startDate.localeCompare(b.startDate));

      const activeDeps = departures.filter(
        (d) =>
          !d.historical &&
          ACTIVE_STATUSES.includes(d.status) &&
          !d.soldOut &&
          (d.cap === null || d.booked < d.cap),
      );
      const currentDeps = departures.filter((d) => !d.historical);
      const regCount = departures.reduce((n, d) => n + d.regs.length, 0);
      return {
        slug: String(trip.slug),
        name,
        active: activeDeps.length > 0,
        nextDate: activeDeps[0]?.startDate ?? currentDeps[0]?.startDate ?? departures[0]?.startDate ?? '9999',
        departures,
        historical: currentDeps.length === 0,
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
    .filter((r) => r.status !== 'rejected' && r.status !== 'wishlist' && r.status !== 'cancelled')
    .reduce((n, r) => n + Number(r.amount_paid || 0), 0);
  const historyCount =
    trips.reduce((n, t) => n + t.departures.filter((d) => d.historical).length, 0) + (legacyRegs.length ? 1 : 0);

  return { registrations, trips, legacyRegs, total, totals, revenue, historyCount };
}
