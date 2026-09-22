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

/**
 * Which stored touch a filter reads.
 *
 * First touch is the default and stays the default: it answers "what found
 * this traveller", and register.ts COALESCEs it so a later campaign can never
 * take credit for the visit that did. Latest touch answers a different
 * question — "what were they last acting on" — which is the only place a
 * campaign shows up for someone who arrived another way and came back through
 * a DM. `either` is the union, for "did this campaign touch them at all".
 *
 * The scope never changes what is STORED or what the row's derived channel
 * says; it changes only which of the two stored touches a filter reads.
 */
export type TouchScope = 'first' | 'latest' | 'either';
export const TOUCH_SCOPES = ['first', 'latest', 'either'] as const;
export const DEFAULT_TOUCH_SCOPE: TouchScope = 'first';
export const TOUCH_SCOPE_LABELS: Record<TouchScope, string> = {
  first: 'First touch',
  latest: 'Latest touch',
  either: 'Either touch',
};

/** Anything unrecognised reads as the default, so a hand-edited URL narrows
 *  nothing silently. */
export function toTouchScope(value: unknown): TouchScope {
  const scope = String(value ?? '');
  return (TOUCH_SCOPES as readonly string[]).includes(scope) ? (scope as TouchScope) : DEFAULT_TOUCH_SCOPE;
}

type TouchColumn = 'first_touch_json' | 'latest_touch_json';

/** A stored touch, or null when the row predates attribution or the blob is
 *  malformed. The only place the touch columns are parsed. */
function storedTouch(r: Reg, column: TouchColumn): Record<string, any> | null {
  try {
    return typeof r[column] === 'string' ? JSON.parse(r[column]) : null;
  } catch {
    return null;
  }
}

const norm = (value: unknown) => String(value ?? '').trim().toLowerCase();

/** Reader for one camelCase key of one stored touch. */
const touchReader = (touchKey: string, column: TouchColumn = 'first_touch_json') =>
  (r: Reg) => norm(storedTouch(r, column)?.[touchKey]);

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
  /** The same, for the latest touch. Equal to `dataAttr` on an unscoped field,
   *  where one attribute serves every scope. */
  latestDataAttr: string;
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
  /**
   * Whether first and latest are genuinely different readings of this row.
   *
   * False for the derived channel alone: `source` is a flat column written once
   * at registration from the FIRST touch, and the latest touch has no stored
   * equivalent — deriving one would mean parsing a referrer hostname, which the
   * export's SQL cannot do, and a filter the screen and the CSV disagree about
   * is worse than one that does not move. So it reads the same under every
   * scope, and its label says so.
   */
  scoped: boolean;
  /** SQL yielding exactly what `read` yields, for the export's WHERE clause. */
  sqlExpr: string;
  /** The same, for `readLatest`. */
  latestSqlExpr: string;
  read: (r: Reg) => string;
  readLatest: (r: Reg) => string;
}

/** json_extract() THROWS on a malformed blob (and on an empty string), which
 *  would 500 the whole export for one bad row — hence the json_valid() guard.
 *  trim(lower()) mirrors norm(), so SQL and JS cannot disagree on whitespace. */
const touchSql = (touchKey: string, column: TouchColumn = 'first_touch_json') =>
  `trim(lower(COALESCE(CASE WHEN json_valid(${column}) THEN json_extract(${column}, '$.${touchKey}') END, '')))`;

/** `utmMedium` -> `attr-utm-medium`. */
const dataAttrFor = (key: string) => `attr-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

const touchField = (
  f: Omit<AttributionField, 'sqlExpr' | 'latestSqlExpr' | 'read' | 'readLatest' | 'dataAttr' | 'latestDataAttr' | 'scoped'>
    & { touchKey: string },
): AttributionField => ({
  key: f.key, dataAttr: dataAttrFor(f.key), latestDataAttr: `${dataAttrFor(f.key)}-latest`,
  param: f.param, label: f.label,
  allLabel: f.allLabel, noneLabel: f.noneLabel, match: f.match, scoped: true,
  sqlExpr: touchSql(f.touchKey), read: touchReader(f.touchKey),
  latestSqlExpr: touchSql(f.touchKey, 'latest_touch_json'),
  readLatest: touchReader(f.touchKey, 'latest_touch_json'),
});

/** The one list the row data attributes, the filter panel, the client matcher
 *  and the export SQL all read from. Add a dimension here and nowhere else. */
export const ATTRIBUTION_FIELDS: readonly AttributionField[] = [
  {
    key: 'source', dataAttr: 'attr-source', latestDataAttr: 'attr-source',
    param: 'source', label: 'Channel (derived, first touch)',
    allLabel: 'All channels', noneLabel: '(not attributed)', match: 'exact', scoped: false,
    sqlExpr: "trim(lower(COALESCE(source, '')))", latestSqlExpr: "trim(lower(COALESCE(source, '')))",
    read: regSource, readLatest: regSource,
  },
  touchField({ key: 'utmSource', param: 'utm_source', label: 'UTM source', allLabel: 'All utm_source', noneLabel: '(no utm_source)', match: 'exact', touchKey: 'utmSource' }),
  touchField({ key: 'utmMedium', param: 'utm_medium', label: 'UTM medium', allLabel: 'All utm_medium', noneLabel: '(no utm_medium)', match: 'exact', touchKey: 'utmMedium' }),
  touchField({ key: 'campaign', param: 'campaign', label: 'Campaign', allLabel: 'All campaigns', noneLabel: '(no campaign)', match: 'exact', touchKey: 'utmCampaign' }),
  // Free text by nature — full URLs and per-ad content values, where a dropdown
  // would be one option per row.
  touchField({ key: 'utmContent', param: 'utm_content', label: 'UTM content', match: 'contains', touchKey: 'utmContent' }),
  touchField({ key: 'utmTerm', param: 'utm_term', label: 'UTM term', match: 'contains', touchKey: 'utmTerm' }),
  // One value per person rather than per campaign, so free text: a dropdown
  // here would be one option per row. Searched, not browsed — the question it
  // answers is "which DM conversation produced this booking".
  touchField({ key: 'subscriberId', param: 'subscriber_id', label: 'DM subscriber', match: 'contains', touchKey: 'subscriberId' }),
  touchField({ key: 'landingPage', param: 'landing_page', label: 'Landing page', match: 'contains', touchKey: 'landingPage' }),
  touchField({ key: 'referrer', param: 'referrer', label: 'Referrer', match: 'contains', touchKey: 'referrer' }),
];

/** The readers one field contributes under a scope — one value for a single
 *  touch, both for `either`. */
export function scopedReaders(field: AttributionField, scope: TouchScope): ((r: Reg) => string)[] {
  if (scope === 'latest') return [field.readLatest];
  if (scope === 'either') return [field.read, field.readLatest];
  return [field.read];
}

/**
 * Whether one row matches one filter value under a scope. THE rule: the client
 * matcher in the trip page mirrors this by hand (an inline script cannot
 * import), and attributionPredicate() below states the same thing in SQL. A
 * unit test runs the two against the same rows, because the failure mode when
 * they drift is a download that quietly holds different rows than the screen.
 *
 * Note the asymmetry under `either`: a VALUE matches when either touch carries
 * it, but UNATTRIBUTED means neither does. "Touched by this campaign at all"
 * and "touched by no campaign at all" are both union questions, and reading the
 * second as "some touch is blank" would put almost every row in that bucket.
 */
export function attributionMatches(
  field: AttributionField, r: Reg, filter: string, scope: TouchScope,
): boolean {
  if (!filter) return true;
  const values = scopedReaders(field, scope).map((read) => read(r));
  if (field.match === 'contains') return values.some((v) => v.includes(filter));
  if (filter === UNATTRIBUTED) return values.every((v) => !v);
  return values.some((v) => v === filter);
}

/** The same rule as SQL, for the export's WHERE clause. */
export function attributionPredicate(
  field: AttributionField, filter: string, scope: TouchScope,
): { sql: string; params: string[] } | null {
  if (!filter) return null;
  const exprs = scope === 'latest' ? [field.latestSqlExpr]
    : scope === 'either' ? [field.sqlExpr, field.latestSqlExpr]
    : [field.sqlExpr];

  if (field.match === 'contains') {
    // instr() rather than LIKE, so no wildcard escaping is needed.
    return {
      sql: `(${exprs.map((e) => `instr(${e}, ?) > 0`).join(' OR ')})`,
      params: exprs.map(() => filter),
    };
  }
  if (filter === UNATTRIBUTED) {
    // Catches legacy and imported rows, whose touch column is NULL.
    return { sql: `(${exprs.map((e) => `${e} = ''`).join(' AND ')})`, params: [] };
  }
  return {
    sql: `(${exprs.map((e) => `${e} = ?`).join(' OR ')})`,
    params: exprs.map(() => filter),
  };
}

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
    // Both touches, always: the panel is rendered once on the server while the
    // scope switches on the client, so a campaign that exists only in the
    // latest touch still has to be selectable — otherwise switching to "latest
    // touch" offers a dropdown that cannot express the thing you switched for.
    const options = [...new Set(
      scopedReaders(field, 'either').flatMap((read) => regs.map(read)).filter(Boolean),
    )].sort();
    const hasNone = regs.some((r) => scopedReaders(field, 'either').some((read) => !read(r)));
    const show = field.match === 'exact'
      ? options.length > 1 || (options.length === 1 && hasNone)
      : options.length > 0;
    return { field, options, hasNone, show };
  });
}

export interface ClientAttributionField {
  key: string;
  dataAttr: string;
  latestDataAttr: string;
  param: string;
  match: 'exact' | 'contains';
}

/** JSON-safe projection for `define:vars`, which serialises with JSON.stringify
 *  and would silently drop `read` and leave the client calling undefined. */
export function clientAttributionFields(): ClientAttributionField[] {
  return ATTRIBUTION_FIELDS.map(({ key, dataAttr, latestDataAttr, param, match }) =>
    ({ key, dataAttr, latestDataAttr, param, match }));
}

/**
 * The at-a-glance attribution shown on a collapsed booking row: "channel/medium
 * · campaign". Admin-created and imported rows read 'admin' rather than "not
 * attributed" — they ARE attributed, to manual entry — so only a genuinely
 * empty row falls back.
 */
export function attributionChip(r: Reg): { label: string; title: string; attributed: boolean } {
  const touch = storedTouch(r, 'first_touch_json');
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
