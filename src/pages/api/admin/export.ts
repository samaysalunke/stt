import type { APIRoute } from 'astro';
import { getDb } from '../../../lib/db';
import type { AdminUser } from '../../../lib/admin-session';

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
    if (tripName) {
      rows = getDb().prepare('SELECT * FROM registrations WHERE trip_name = ? ORDER BY id DESC').all(tripName) as Record<string, any>[];
      filename = `registrations-${tripName.toLowerCase().replace(/\s+/g, '-')}-${date}.csv`;
    } else {
      rows = getDb().prepare('SELECT * FROM registrations ORDER BY id DESC').all() as Record<string, any>[];
      filename = `registrations-${date}.csv`;
    }
  } else if (type === 'contacts') {
    rows = getDb().prepare('SELECT * FROM contact_submissions ORDER BY id DESC').all() as Record<string, any>[];
    filename = `contacts-${date}.csv`;
  } else if (type === 'newsletter') {
    rows = getDb().prepare('SELECT * FROM newsletter_subscribers ORDER BY id DESC').all() as Record<string, any>[];
    filename = `newsletter-${date}.csv`;
  } else if (type === 'customers') {
    const isTripLead = adminUser?.role === 'trip_lead';
    const allowedBatchIds: string[] | null = isTripLead ? (adminUser?.tripIds ?? []) : null;
    const batchWhere = allowedBatchIds === null ? '' :
      allowedBatchIds.length > 0 ? `WHERE r.batch_id IN (${allowedBatchIds.map(() => '?').join(',')})` : 'WHERE 1=0';
    const batchParams: string[] = allowedBatchIds?.length ? allowedBatchIds : [];
    const sql = `
      SELECT
        lower(trim(r.email)) AS email,
        (SELECT full_name FROM registrations WHERE lower(trim(email)) = lower(trim(r.email)) ORDER BY created_at DESC LIMIT 1) AS full_name,
        (SELECT phone     FROM registrations WHERE lower(trim(email)) = lower(trim(r.email)) ORDER BY created_at DESC LIMIT 1) AS phone,
        (SELECT city      FROM registrations WHERE lower(trim(email)) = lower(trim(r.email)) ORDER BY created_at DESC LIMIT 1) AS city,
        COUNT(*) AS total_regs,
        SUM(CASE WHEN r.status='confirmed' THEN 1 ELSE 0 END) AS confirmed,
        SUM(CASE WHEN r.status='pending'   THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN r.status='lead'      THEN 1 ELSE 0 END) AS lead,
        SUM(CASE WHEN r.status='wishlist'  THEN 1 ELSE 0 END) AS wishlist,
        SUM(CASE WHEN r.status='rejected'  THEN 1 ELSE 0 END) AS rejected,
        SUM(COALESCE(r.amount_paid, 0)) AS total_paid,
        max(r.payment_date) AS last_payment_date,
        max(r.created_at)   AS last_reg_at,
        (SELECT COALESCE(trip_slug, trip_name) FROM registrations WHERE lower(trim(email)) = lower(trim(r.email)) ORDER BY created_at DESC LIMIT 1) AS latest_trip,
        u.username, u.displayName
      FROM registrations r
      LEFT JOIN users u ON lower(trim(u.email)) = lower(trim(r.email))
      ${batchWhere}
      GROUP BY lower(trim(r.email))
      ORDER BY last_reg_at DESC
    `;
    rows = (batchParams.length > 0
      ? getDb().prepare(sql).all(...batchParams)
      : getDb().prepare(sql).all()) as Record<string, any>[];
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
