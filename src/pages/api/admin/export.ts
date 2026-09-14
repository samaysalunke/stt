import type { APIRoute } from 'astro';
import { getDb } from '../../../lib/db';
import { likeTerm } from '../../../lib/utils';
import {
  buildCustomerQuery, CUSTOMER_ORDER_BY, CUSTOMER_TYPES, EXPORT_COLUMNS,
} from '../../../lib/customersView';
import { UNATTRIBUTED } from '../../../lib/registrationsView';
import type { AdminUser } from '../../../lib/admin-session';

/**
 * Attribution reaches the CSV as raw first_touch_json / latest_touch_json,
 * which is unusable in a spreadsheet. Add flat first-touch columns alongside
 * it. Every row gets every key, including rows with no attribution: toCSV()
 * derives its header row from the first row's keys, so a row-dependent shape
 * would silently drop columns from the whole download.
 */
const ATTRIBUTION_COLUMNS = {
  utm_source: 'utmSource', utm_medium: 'utmMedium', utm_campaign: 'utmCampaign',
  utm_term: 'utmTerm', utm_content: 'utmContent',
  landing_page: 'landingPage', referrer: 'referrer',
} as const;

function flattenAttribution(row: Record<string, any>): Record<string, any> {
  let touch: Record<string, any> | null = null;
  try {
    touch = typeof row.first_touch_json === 'string' ? JSON.parse(row.first_touch_json) : null;
  } catch { /* malformed stored touch — export the row with blank columns */ }
  const flat: Record<string, any> = {};
  for (const [column, key] of Object.entries(ATTRIBUTION_COLUMNS)) flat[column] = touch?.[key] ?? '';
  return { ...row, ...flat };
}

function toCSV(rows: Record<string, any>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v: any) => {
    const s = (v ?? '').toString().replace(/"/g, '""');
    return `"${s}"`;
  };
  const lines = [
    headers.join(','),
    ...rows.map(row => headers.map(h => escape(row[h])).join(',')),
  ];
  return lines.join('\r\n');
}

export const GET: APIRoute = async ({ url, locals }) => {
  const adminUser = (locals as any).adminUser as AdminUser | undefined;
  const type = url.searchParams.get('type') ?? 'registrations';
  const date = new Date().toISOString().slice(0, 10);

  let rows: Record<string, any>[] = [];
  let filename = '';

  if (type === 'registrations') {
    const tripName = url.searchParams.get('trip_name');
    const search = (url.searchParams.get('q') ?? '').trim().toLowerCase().slice(0, 200);
    const requestedStatus = url.searchParams.get('status') ?? '';
    const statuses = ['wishlist', 'lead', 'pending', 'confirmed', 'rejected', 'cancelled'];
    const status = statuses.includes(requestedStatus) ? requestedStatus : '';
    const batchIds = url.searchParams.getAll('batch_id').filter(Boolean);
    const batchFilter = url.searchParams.get('batch_filter') === '1';
    const isTripLead = adminUser?.role === 'trip_lead';
    const allowedBatchIds: string[] | null = isTripLead ? (adminUser?.tripIds ?? []) : null;
    const where: string[] = [];
    const params: string[] = [];

    if (allowedBatchIds !== null) {
      if (allowedBatchIds.length === 0) where.push('1=0');
      else {
        where.push(`batch_id IN (${allowedBatchIds.map(() => '?').join(',')})`);
        params.push(...allowedBatchIds);
      }
    }
    if (tripName) {
      where.push('trip_name = ?');
      params.push(tripName);
    }
    if (batchFilter) {
      if (batchIds.length === 0) where.push('1=0');
      else {
        where.push(`batch_id IN (${batchIds.map(() => '?').join(',')})`);
        params.push(...batchIds);
      }
    }
    if (status) {
      where.push('status = ?');
      params.push(status);
    }
    if (search) {
      where.push("(lower(COALESCE(full_name, '')) LIKE ? ESCAPE '\\' OR lower(COALESCE(email, '')) LIKE ? ESCAPE '\\' OR lower(COALESCE(phone, '')) LIKE ? ESCAPE '\\')");
      const term = likeTerm(search);
      params.push(term, term, term);
    }

    // Attribution filters, mirroring the source/campaign selects on the trip
    // page so an export taken with a filter active matches what was on screen.
    // Both normalise to lowercase because that is how the row data attributes
    // the selects are built from are normalised (see regSource/regCampaign).
    const source = (url.searchParams.get('source') ?? '').trim().toLowerCase().slice(0, 200);
    const campaign = (url.searchParams.get('campaign') ?? '').trim().toLowerCase().slice(0, 200);
    if (source === UNATTRIBUTED) {
      where.push("COALESCE(source, '') = ''");
    } else if (source) {
      where.push('lower(source) = ?');
      params.push(source);
    }
    // Campaign has no column of its own — it is read out of the stored first
    // touch. json_extract returns NULL for a NULL/!JSON column, so the
    // unattributed branch catches legacy and imported rows too.
    if (campaign === UNATTRIBUTED) {
      where.push("COALESCE(lower(json_extract(first_touch_json, '$.utmCampaign')), '') = ''");
    } else if (campaign) {
      where.push("lower(json_extract(first_touch_json, '$.utmCampaign')) = ?");
      params.push(campaign);
    }

    const sql = `SELECT * FROM registrations ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC`;
    rows = (getDb().prepare(sql).all(...params) as Record<string, any>[]).map(flattenAttribution);
    filename = tripName
      ? `registrations-${tripName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${date}.csv`
      : `registrations-${date}.csv`;
  } else if (type === 'contacts') {
    const requestedStatus = url.searchParams.get('status') ?? '';
    const status = ['new', 'resolved'].includes(requestedStatus) ? requestedStatus : '';
    rows = (status
      ? getDb().prepare('SELECT * FROM contact_submissions WHERE COALESCE(status, \'new\') = ? ORDER BY id DESC').all(status)
      : getDb().prepare('SELECT * FROM contact_submissions ORDER BY id DESC').all()) as Record<string, any>[];
    filename = `contacts-${date}.csv`;
  } else if (type === 'newsletter') {
    rows = getDb().prepare('SELECT * FROM newsletter_subscribers ORDER BY id DESC').all() as Record<string, any>[];
    filename = `newsletter-${date}.csv`;
  } else if (type === 'customers') {
    const search = (url.searchParams.get('q') ?? '').trim().toLowerCase().slice(0, 200);
    const requestedCustomerType = url.searchParams.get('customer_type') ?? '';
    const customerType = (CUSTOMER_TYPES as readonly string[]).includes(requestedCustomerType)
      ? requestedCustomerType
      : '';

    // EXPORT_COLUMNS rather than `SELECT *`: toCSV() derives its header row from
    // the keys of the first object, so any column added to the shared
    // aggregation would otherwise silently widen this download.
    const query = buildCustomerQuery(adminUser, { q: search, customerType });
    rows = getDb().prepare(`
      ${query.cte}
      SELECT ${EXPORT_COLUMNS} FROM customers
      ${query.where}
      ${CUSTOMER_ORDER_BY}
    `).all(...query.params) as Record<string, any>[];
    filename = `customers-${date}.csv`;
  } else {
    return new Response('Invalid type', { status: 400 });
  }

  const csv = '﻿' + toCSV(rows); // BOM for Excel compatibility
  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
};
