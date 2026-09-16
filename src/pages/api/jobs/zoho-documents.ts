import { timingSafeEqual } from 'node:crypto';
import type { APIRoute } from 'astro';
import { claimZohoDocuments, processZohoDocument } from '../../../lib/zohoBooks';

const configuredSecret = () => String((import.meta.env as any).ZOHO_JOB_SECRET || process.env.ZOHO_JOB_SECRET || '');
const authorized = (request: Request) => {
  const expected = configuredSecret();
  const supplied = String(request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!expected || supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
};

/** Bounded cron worker: each document is independent and safe to retry. */
export const POST: APIRoute = async ({ request }) => {
  if (!authorized(request)) return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  const jobs = claimZohoDocuments(10);
  const settled = await Promise.allSettled(jobs.map((job) => processZohoDocument(job.id)));
  const failed = settled.filter((result) => result.status === 'rejected').length;
  return new Response(JSON.stringify({ success: true, processed: jobs.length, failed }), { headers: { 'Content-Type': 'application/json' } });
};
