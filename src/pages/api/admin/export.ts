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

function likeTerm(value: string): string {
  return `%${value.replace(/[\\%_]/g, '\\$&')}%`;
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

    const sql = `SELECT * FROM registrations ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC`;
    rows = getDb().prepare(sql).all(...params) as Record<string, any>[];
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
    const isTripLead = adminUser?.role === 'trip_lead';
    const allowedBatchIds: string[] | null = isTripLead ? (adminUser?.tripIds ?? []) : null;
    const batchWhere = allowedBatchIds === null ? '' :
      allowedBatchIds.length > 0 ? `WHERE r.batch_id IN (${allowedBatchIds.map(() => '?').join(',')})` : 'WHERE 1=0';
    const batchParams: string[] = allowedBatchIds?.length ? allowedBatchIds : [];
    const search = (url.searchParams.get('q') ?? '').trim().toLowerCase().slice(0, 200);
    const requestedCustomerType = url.searchParams.get('customer_type') ?? '';
    const customerTypes = ['has-account', 'no-account', 'repeat', 'confirmed', 'pending', 'unpaid'];
    const customerType = customerTypes.includes(requestedCustomerType) ? requestedCustomerType : '';
    const filters: string[] = [];
    const filterParams: string[] = [];
    if (search) {
      filters.push("(lower(COALESCE(full_name, '')) LIKE ? ESCAPE '\\' OR lower(COALESCE(email, '')) LIKE ? ESCAPE '\\' OR lower(COALESCE(phone, '')) LIKE ? ESCAPE '\\' OR lower(COALESCE(username, '')) LIKE ? ESCAPE '\\' OR lower(COALESCE(city, '')) LIKE ? ESCAPE '\\')");
      const term = likeTerm(search);
      filterParams.push(term, term, term, term, term);
    }
    if (customerType === 'has-account') filters.push('user_id IS NOT NULL');
    if (customerType === 'no-account') filters.push('user_id IS NULL');
    if (customerType === 'repeat') filters.push('total_regs >= 2');
    if (customerType === 'confirmed') filters.push('confirmed > 0');
    if (customerType === 'pending') filters.push('pending > 0');
    if (customerType === 'unpaid') filters.push('total_paid = 0 AND (confirmed + pending) > 0');

    const sql = `
      WITH customers AS (
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
        SUM(CASE WHEN r.status='cancelled' THEN 1 ELSE 0 END) AS cancelled,
        SUM(COALESCE(r.amount_paid, 0)) AS total_paid,
        SUM(COALESCE(r.amount_refunded, 0)) AS total_refunded,
        max(r.payment_date) AS last_payment_date,
        max(r.created_at)   AS last_reg_at,
        (SELECT COALESCE(trip_slug, trip_name) FROM registrations WHERE lower(trim(email)) = lower(trim(r.email)) ORDER BY created_at DESC LIMIT 1) AS latest_trip,
        u.id AS user_id, u.username, u.displayName
      FROM registrations r
      LEFT JOIN users u ON lower(trim(u.email)) = lower(trim(r.email))
      ${batchWhere}
      GROUP BY lower(trim(r.email))
      )
      SELECT * FROM customers
      ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
      ORDER BY last_reg_at DESC
    `;
    rows = getDb().prepare(sql).all(...batchParams, ...filterParams) as Record<string, any>[];
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
