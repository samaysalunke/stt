import { timingSafeEqual } from 'node:crypto';
import type { APIRoute } from 'astro';
import { getDb } from '../../../lib/db';
import { claimTelegramEvents, processClaimedTelegramEvent } from '../../../lib/telegram';

const configuredToken = () => String((import.meta.env as any).TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '');

function authorized(request: Request): boolean {
  const expected = configuredToken();
  const supplied = String(request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!expected || supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

/** Bounded retry worker. Claims are atomic and dispatching jobs are never reclaimed. */
export const POST: APIRoute = async ({ request }) => {
  if (!authorized(request)) {
    return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }
  const jobs = claimTelegramEvents(getDb(), 10);
  const settled = await Promise.allSettled(jobs.map(processClaimedTelegramEvent));
  const failed = settled.filter((result) => result.status === 'rejected').length;
  return new Response(JSON.stringify({ success: true, processed: jobs.length, failed }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
