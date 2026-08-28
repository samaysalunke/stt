import { getDb } from '../db';
import { stripBlockedRows } from './schema';
import { findDepartureById, findTripBySlug, findTripsByText } from './trips';

export interface ToolResult {
  columns: string[];
  rows: unknown[][];
  summary: string;
  needsSelection?: {
    type: 'trip' | 'departure';
    prompt: string;
    options: Array<{ id: string; label: string; dateRange?: string; status?: string }>;
  };
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (params: Record<string, any>) => ToolResult;
}

const READ_MUTATION_RE = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|REPLACE|VACUUM|ATTACH|DETACH|PRAGMA)\b/i;

function all(sql: string, params: unknown[] = []): Record<string, any>[] {
  if (READ_MUTATION_RE.test(sql)) throw new Error('Mutation keyword rejected in analytics resolver');
  return getDb().prepare(sql).all(...params) as Record<string, any>[];
}

function shape(rows: Record<string, any>[], summary: string): ToolResult {
  const columns = rows[0] ? Object.keys(rows[0]) : [];
  const values = rows.map((row) => columns.map((column) => row[column]));
  const stripped = stripBlockedRows(columns, values);
  return { ...stripped, summary };
}

function dateWhere(params: Record<string, any>, column = 'created_at'): { sql: string; values: unknown[] } {
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (params.startDate) {
    clauses.push(`date(${column}) >= date(?)`);
    values.push(params.startDate);
  }
  if (params.endDate) {
    clauses.push(`date(${column}) <= date(?)`);
    values.push(params.endDate);
  }
  return { sql: clauses.length ? ` AND ${clauses.join(' AND ')}` : '', values };
}

function tripFilter(params: Record<string, any>): { sql: string; values: unknown[] } {
  if (params.departureId) return { sql: ' AND batch_id = ?', values: [params.departureId] };
  if (params.tripSlug) return { sql: ' AND trip_slug = ?', values: [params.tripSlug] };
  return { sql: '', values: [] };
}

function tripMeta(slug: string | null | undefined) {
  return slug ? findTripBySlug(String(slug)) : null;
}

function withTripTitles(rows: Record<string, any>[], slugCol = 'trip_slug') {
  return rows.map((row) => {
    const trip = tripMeta(row[slugCol]);
    return { ...row, trip_title: trip?.title ?? row.trip_name ?? row[slugCol] ?? 'Unknown trip', location: trip?.location ?? row.location ?? '' };
  });
}

const objectParams = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

export const analyticsTools: ToolDefinition[] = [
  {
    name: 'getRevenueByTrip',
    description: 'Revenue per trip using SUM(amount_paid) where status is not rejected.',
    parameters: objectParams({ startDate: { type: 'string' }, endDate: { type: 'string' } }),
    execute(params) {
      const d = dateWhere(params);
      const rows = withTripTitles(all(
        `SELECT COALESCE(trip_slug, trip_name) AS trip_slug, trip_name, SUM(COALESCE(amount_paid, 0)) AS revenue
         FROM registrations WHERE status NOT IN ('rejected', 'cancelled')${d.sql}
         GROUP BY COALESCE(trip_slug, trip_name), trip_name ORDER BY revenue DESC`,
        d.values,
      ));
      return shape(rows, 'Revenue by trip excludes rejected registrations.');
    },
  },
  {
    name: 'getRevenueByLocation',
    description: 'Revenue grouped by trip location.',
    parameters: objectParams({ startDate: { type: 'string' }, endDate: { type: 'string' } }),
    execute(params) {
      const tripResult = getTool('getRevenueByTrip')!.execute(params);
      const locIdx = tripResult.columns.indexOf('location');
      const revIdx = tripResult.columns.indexOf('revenue');
      const byLocation = new Map<string, number>();
      for (const row of tripResult.rows) {
        const location = String(row[locIdx] || 'Unknown');
        byLocation.set(location, (byLocation.get(location) ?? 0) + Number(row[revIdx] || 0));
      }
      return shape([...byLocation].map(([location, revenue]) => ({ location, revenue })), 'Revenue grouped by YAML trip location.');
    },
  },
  {
    name: 'getTopTripsByRevenue',
    description: 'Top N trips by revenue.',
    parameters: objectParams({ limit: { type: 'number' }, startDate: { type: 'string' }, endDate: { type: 'string' } }),
    execute(params) {
      const result = getTool('getRevenueByTrip')!.execute(params);
      const limit = Math.max(1, Math.min(50, Number(params.limit || 10)));
      return { ...result, rows: result.rows.slice(0, limit), summary: `Top ${limit} trips by revenue, excluding rejected registrations.` };
    },
  },
  {
    name: 'getBookingsByStatus',
    description: 'Registration counts by status, optionally filtered by trip or departure.',
    parameters: objectParams({ tripSlug: { type: 'string' }, departureId: { type: 'string' } }),
    execute(params) {
      const f = tripFilter(params);
      return shape(all(`SELECT status, COUNT(*) AS count FROM registrations WHERE 1=1${f.sql} GROUP BY status ORDER BY count DESC`, f.values), 'Bookings grouped by status.');
    },
  },
  {
    name: 'getPendingPayments',
    description: 'Outstanding balances by trip using total_amount minus amount_paid.',
    parameters: objectParams({}),
    execute() {
      const rows = withTripTitles(all(
        `SELECT COALESCE(trip_slug, trip_name) AS trip_slug, trip_name,
                SUM(MAX(COALESCE(total_amount, 0) - COALESCE(amount_paid, 0), 0)) AS pending_amount,
                COUNT(*) AS registrations
         FROM registrations
         WHERE status NOT IN ('rejected', 'cancelled') AND COALESCE(total_amount, 0) > COALESCE(amount_paid, 0)
         GROUP BY COALESCE(trip_slug, trip_name), trip_name
         ORDER BY pending_amount DESC`,
      ));
      return shape(rows, 'Pending payments are total amount minus amount paid for non-rejected registrations.');
    },
  },
  {
    name: 'getRepeatCustomers',
    description: 'Customers with more than one confirmed registration, anonymized by customer id.',
    parameters: objectParams({}),
    execute() {
      return shape(all(
        `SELECT lower(trim(email)) AS customer_key, COUNT(*) AS confirmed_registrations, SUM(COALESCE(amount_paid, 0)) AS total_paid
         FROM registrations
         WHERE status = 'confirmed'
         GROUP BY lower(trim(email))
         HAVING COUNT(*) > 1
         ORDER BY confirmed_registrations DESC, total_paid DESC`,
      ).map((row, i) => ({ customer_id: `customer_${i + 1}`, confirmed_registrations: row.confirmed_registrations, total_paid: row.total_paid })), 'Repeat customers are anonymized and counted from confirmed registrations.');
    },
  },
  {
    name: 'getCustomerCountByTrip',
    description: 'Headcount per trip/departure.',
    parameters: objectParams({}),
    execute() {
      return shape(withTripTitles(all(
        `SELECT COALESCE(trip_slug, trip_name) AS trip_slug, trip_name, batch_id, COUNT(*) AS registrations,
                SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed
         FROM registrations
         WHERE status NOT IN ('rejected', 'cancelled')
         GROUP BY COALESCE(trip_slug, trip_name), trip_name, batch_id
         ORDER BY registrations DESC`,
      )), 'Headcount excludes rejected registrations and includes confirmed counts.');
    },
  },
  {
    name: 'getDailyRevenueTrend',
    description: 'Revenue trend over a date range. Server chooses daily, weekly, or monthly granularity.',
    parameters: objectParams({ startDate: { type: 'string' }, endDate: { type: 'string' } }),
    execute(params) {
      const granularity = chooseGranularity(params.startDate, params.endDate);
      const expr = granularity === 'monthly'
        ? "strftime('%Y-%m', created_at)"
        : granularity === 'weekly'
          ? "strftime('%Y-W%W', created_at)"
          : 'date(created_at)';
      const d = dateWhere(params);
      return shape(all(
        `SELECT ${expr} AS period, SUM(COALESCE(amount_paid, 0)) AS revenue
         FROM registrations WHERE status NOT IN ('rejected', 'cancelled')${d.sql}
         GROUP BY ${expr} ORDER BY period ASC`,
        d.values,
      ), `Revenue trend uses ${granularity} granularity and excludes rejected registrations.`);
    },
  },
  {
    name: 'getTripComparison',
    description: 'Side-by-side revenue and registration stats for selected trips.',
    parameters: objectParams({ tripSlugs: { type: 'array', items: { type: 'string' } } }, ['tripSlugs']),
    execute(params) {
      const slugs = Array.isArray(params.tripSlugs) ? params.tripSlugs.slice(0, 10) : [];
      if (!slugs.length) return shape([], 'No trips were supplied for comparison.');
      const placeholders = slugs.map(() => '?').join(',');
      return shape(withTripTitles(all(
        `SELECT trip_slug, COUNT(*) AS registrations,
                SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed,
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
                SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
                SUM(CASE WHEN status NOT IN ('rejected', 'cancelled') THEN COALESCE(amount_paid, 0) ELSE 0 END) AS revenue
         FROM registrations WHERE trip_slug IN (${placeholders}) GROUP BY trip_slug ORDER BY revenue DESC`,
        slugs,
      )), 'Trip comparison uses revenue excluding rejected registrations.');
    },
  },
  {
    name: 'findTripsByQuery',
    description: 'Fuzzy match trips by title, slug, or location.',
    parameters: objectParams({ query: { type: 'string' } }, ['query']),
    execute(params) {
      const trips = findTripsByText(String(params.query || '')).slice(0, 8);
      const rows = trips.map((trip) => ({ id: trip.slug, title: trip.title, slug: trip.slug, location: trip.location, departures: trip.departures.length }));
      const result = shape(rows, trips.length > 1 ? 'Multiple matching trips found. Ask the owner to choose one.' : 'Trip match result.');
      if (trips.length > 1) {
        result.needsSelection = {
          type: 'trip',
          prompt: 'Which trip should I use?',
          options: trips.map((trip) => ({ id: trip.slug, label: `${trip.title} · ${trip.location}`, status: trip.status })),
        };
      }
      return result;
    },
  },
  {
    name: 'getDepartureSummary',
    description: 'Stats for a specific departure/batch.',
    parameters: objectParams({ departureId: { type: 'string' } }, ['departureId']),
    execute(params) {
      const departure = findDepartureById(String(params.departureId || ''));
      const f = tripFilter({ departureId: params.departureId });
      const rows = all(
        `SELECT batch_id, COUNT(*) AS registrations,
                SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed,
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
                SUM(CASE WHEN status = 'lead' THEN 1 ELSE 0 END) AS leads,
                SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
                SUM(CASE WHEN status NOT IN ('rejected', 'cancelled') THEN COALESCE(amount_paid, 0) ELSE 0 END) AS revenue
         FROM registrations WHERE 1=1${f.sql} GROUP BY batch_id`,
        f.values,
      ).map((row) => ({ ...row, trip_title: departure?.tripTitle ?? '', startDate: departure?.startDate ?? '', endDate: departure?.endDate ?? '', capacity: departure?.capacity ?? null }));
      return shape(rows, 'Departure summary combines YAML departure metadata with registration stats.');
    },
  },
  {
    name: 'getConversionRate',
    description: 'Confirmed registrations divided by all registrations.',
    parameters: objectParams({ tripSlug: { type: 'string' }, departureId: { type: 'string' } }),
    execute(params) {
      const f = tripFilter(params);
      const rows = all(
        `SELECT COUNT(*) AS total_registrations,
                SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed,
                ROUND(100.0 * SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 2) AS conversion_rate_percent
         FROM registrations WHERE 1=1${f.sql}`,
        f.values,
      );
      return shape(rows, 'Conversion is confirmed registrations divided by all registrations because there is no separate leads table.');
    },
  },
  {
    name: 'getGenderBreakdown',
    description: 'Gender ratio, optionally filtered.',
    parameters: objectParams({ tripSlug: { type: 'string' }, departureId: { type: 'string' } }),
    execute(params) {
      const f = tripFilter(params);
      return shape(all(
        `SELECT COALESCE(NULLIF(lower(trim(gender)), ''), 'unknown') AS gender, COUNT(*) AS count,
                ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) AS percent
         FROM registrations WHERE 1=1${f.sql} GROUP BY COALESCE(NULLIF(lower(trim(gender)), ''), 'unknown') ORDER BY count DESC`,
        f.values,
      ), 'Gender breakdown uses the captured registrations.gender field.');
    },
  },
  {
    name: 'getAgeDistribution',
    description: 'Age buckets: 18-24, 25-30, 31-40, 40+.',
    parameters: objectParams({ tripSlug: { type: 'string' }, departureId: { type: 'string' } }),
    execute(params) {
      const f = tripFilter(params);
      return shape(all(
        `SELECT CASE
           WHEN CAST(age AS INTEGER) BETWEEN 18 AND 24 THEN '18-24'
           WHEN CAST(age AS INTEGER) BETWEEN 25 AND 30 THEN '25-30'
           WHEN CAST(age AS INTEGER) BETWEEN 31 AND 40 THEN '31-40'
           WHEN CAST(age AS INTEGER) > 40 THEN '40+'
           ELSE 'unknown'
         END AS age_bucket, COUNT(*) AS count
         FROM registrations WHERE 1=1${f.sql}
         GROUP BY age_bucket ORDER BY CASE age_bucket WHEN '18-24' THEN 1 WHEN '25-30' THEN 2 WHEN '31-40' THEN 3 WHEN '40+' THEN 4 ELSE 5 END`,
        f.values,
      ), 'Age distribution uses registrations.age buckets.');
    },
  },
  {
    name: 'getDemographicBreakdown',
    description: 'Generic demographic grouping by allowed captured fields.',
    parameters: objectParams({ field: { type: 'string', enum: ['city', 'source', 'source_detail', 'state', 'country', 'gender', 'age'] }, tripSlug: { type: 'string' }, departureId: { type: 'string' } }, ['field']),
    execute(params) {
      const field = String(params.field || '');
      if (!['city', 'source', 'source_detail', 'state', 'country', 'gender', 'age'].includes(field)) {
        return shape([], `${field} is not tracked as a returnable demographic field.`);
      }
      const f = tripFilter(params);
      return shape(all(
        `SELECT COALESCE(NULLIF(trim(${field}), ''), 'unknown') AS ${field}, COUNT(*) AS count
         FROM registrations WHERE 1=1${f.sql} GROUP BY COALESCE(NULLIF(trim(${field}), ''), 'unknown') ORDER BY count DESC LIMIT 50`,
        f.values,
      ), `Breakdown grouped by registrations.${field}.`);
    },
  },
  {
    name: 'getRegistrationSourceBreakdown',
    description: 'Registrations by source/channel.',
    parameters: objectParams({}),
    execute() {
      return getTool('getDemographicBreakdown')!.execute({ field: 'source' });
    },
  },
  {
    name: 'getCustomerLifetimeValue',
    description: 'Anonymized total spend per customer.',
    parameters: objectParams({ limit: { type: 'number' } }),
    execute(params) {
      const limit = Math.max(1, Math.min(100, Number(params.limit || 25)));
      return shape(all(
        `SELECT lower(trim(email)) AS customer_key, COUNT(*) AS registrations,
                SUM(CASE WHEN status NOT IN ('rejected', 'cancelled') THEN COALESCE(amount_paid, 0) ELSE 0 END) AS lifetime_value
         FROM registrations GROUP BY lower(trim(email)) ORDER BY lifetime_value DESC LIMIT ?`,
        [limit],
      ).map((row, i) => ({ customer_id: `customer_${i + 1}`, registrations: row.registrations, lifetime_value: row.lifetime_value })), 'Customer lifetime value is anonymized and excludes rejected revenue.');
    },
  },
  {
    name: 'getNewVsRepeatCustomerTrend',
    description: 'New vs repeat customer registrations by month.',
    parameters: objectParams({}),
    execute() {
      return shape(all(
        `WITH ordered AS (
           SELECT date(created_at) AS d, strftime('%Y-%m', created_at) AS month, lower(trim(email)) AS customer_key,
                  ROW_NUMBER() OVER (PARTITION BY lower(trim(email)) ORDER BY datetime(created_at), id) AS rn
           FROM registrations WHERE status NOT IN ('rejected', 'cancelled')
         )
         SELECT month,
                SUM(CASE WHEN rn = 1 THEN 1 ELSE 0 END) AS new_customers,
                SUM(CASE WHEN rn > 1 THEN 1 ELSE 0 END) AS repeat_customers
         FROM ordered GROUP BY month ORDER BY month ASC`,
      ), 'New vs repeat trend uses first non-rejected registration per anonymized customer.');
    },
  },
  {
    name: 'getRevenuePerSeat',
    description: 'Revenue divided by confirmed seats per trip.',
    parameters: objectParams({}),
    execute() {
      return shape(withTripTitles(all(
        `SELECT COALESCE(trip_slug, trip_name) AS trip_slug, trip_name,
                SUM(CASE WHEN status NOT IN ('rejected', 'cancelled') THEN COALESCE(amount_paid, 0) ELSE 0 END) AS revenue,
                SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed_seats,
                ROUND(1.0 * SUM(CASE WHEN status NOT IN ('rejected', 'cancelled') THEN COALESCE(amount_paid, 0) ELSE 0 END) /
                  NULLIF(SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END), 0), 2) AS revenue_per_seat
         FROM registrations GROUP BY COALESCE(trip_slug, trip_name), trip_name ORDER BY revenue_per_seat DESC`,
      )), 'Revenue per seat is non-rejected revenue divided by confirmed registrations.');
    },
  },
];

export function getTool(name: string): ToolDefinition | undefined {
  return analyticsTools.find((tool) => tool.name === name);
}

export function namedToolSchemas(): Array<{ name: string; description: string; parameters: Record<string, unknown> }> {
  return analyticsTools.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters }));
}

export function chooseGranularity(start?: string, end?: string): 'daily' | 'weekly' | 'monthly' {
  if (!start || !end) return 'daily';
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  const days = Math.abs(e.getTime() - s.getTime()) / 86_400_000;
  if (!Number.isFinite(days) || days <= 90) return 'daily';
  if (days <= 365) return 'weekly';
  return 'monthly';
}

export function defaultSuggestions(): string[] {
  return [
    'How much revenue came from the past 3 trips?',
    'List the top 3 trips by revenue.',
    'Show pending payments by trip.',
    'What is the male vs female ratio across all trips?',
    "What's the age distribution of our customers?",
    'Show daily revenue trend for the last 30 days.',
    'How many repeat customers do we have?',
  ];
}

export function routeNamedTool(message: string, selection?: { type: 'trip' | 'departure'; id: string }): { name: string; input: Record<string, any> } {
  const text = message.toLowerCase();
  const input: Record<string, any> = {};
  if (selection?.type === 'trip') input.tripSlug = selection.id;
  if (selection?.type === 'departure') input.departureId = selection.id;
  if (text.includes('gender') || text.includes('male') || text.includes('female')) return { name: 'getGenderBreakdown', input };
  if (text.includes('age')) return { name: 'getAgeDistribution', input };
  if (text.includes('pending payment') || text.includes('outstanding')) return { name: 'getPendingPayments', input };
  if (text.includes('repeat')) return { name: text.includes('trend') ? 'getNewVsRepeatCustomerTrend' : 'getRepeatCustomers', input };
  if (text.includes('conversion')) return { name: 'getConversionRate', input };
  if (text.includes('source')) return { name: 'getRegistrationSourceBreakdown', input };
  if (text.includes('location')) return { name: 'getRevenueByLocation', input };
  if (text.includes('daily') || text.includes('trend')) {
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - 30);
    return { name: 'getDailyRevenueTrend', input: { ...input, startDate: start.toISOString().slice(0, 10), endDate: now.toISOString().slice(0, 10) } };
  }
  if (text.includes('top')) return { name: 'getTopTripsByRevenue', input: { ...input, limit: Number(text.match(/top\s+(\d+)/)?.[1] || 3) } };
  if (text.includes('revenue per seat')) return { name: 'getRevenuePerSeat', input };
  if (text.includes('booking') || text.includes('status')) return { name: 'getBookingsByStatus', input };
  return { name: 'getRevenueByTrip', input };
}

export function tripOptionsForAmbiguousMessage(message: string) {
  const quoted = message.match(/["']([^"']+)["']/)?.[1];
  const query = quoted || message.replace(/\b(revenue|bookings|status|for|show|trip|the|in|of|by|how|much)\b/gi, ' ');
  const matches = findTripsByText(query);
  if (matches.length > 1 && matches.length <= 6) {
    return {
      type: 'trip' as const,
      prompt: 'Which trip should I use?',
      options: matches.map((trip) => ({ id: trip.slug, label: `${trip.title} · ${trip.location}`, status: trip.status })),
    };
  }
  return null;
}
