/**
 * The thing that actually runs the background workers.
 *
 * Both `/api/jobs/zoho-documents` and `/api/jobs/telegram-notifications` were
 * built to be polled by a scheduler that was only ever described in prose, in
 * `docs/zoho-books-rollout.md` and `docs/telegram-booking-notifications.md`.
 * Nothing ever polled them, so nothing was ever retried: every failed invoice
 * sat at one attempt with its backoff long elapsed, and the worker's own
 * "payment received, no PDF" fallback — which waits for a third attempt —
 * could not fire either.
 *
 * Railway's cron cannot fill the gap. It runs a service's start command on a
 * schedule and expects the process to exit, which a web server does not do,
 * and the SQLite volume is mounted to this service alone, so a second service
 * could not reach the database anyway. That leaves an in-process timer, which
 * is safe here for a specific reason: `better-sqlite3` pins this deployment to
 * a single replica (see `move-to-prod.md`), so there is exactly one of these.
 *
 * Shape follows the pruning timer in `lib/rateLimit.ts`: module scope, and
 * `.unref()` so it never holds the process open at shutdown.
 */
import { getDb } from './db';
import { claimZohoDocuments, processZohoDocument } from './zohoBooks';
import { zohoMode } from './paymentLedger';
import { claimTelegramEvents, processClaimedTelegramEvent, telegramConfigured } from './telegram';

const TICK_MS = 60_000;
/** Matches the cap both job endpoints already use. */
const BATCH = 10;

/**
 * Off unless explicitly switched on, so `astro dev`, `tests/run.mjs` and
 * Playwright never make real Zoho or Telegram calls. It doubles as the kill
 * switch: unset it in Railway and all background processing stops without a
 * deploy.
 */
export function schedulerEnabled(): boolean {
  const value = (import.meta.env as any).JOBS_SCHEDULER || process.env.JOBS_SCHEDULER;
  return String(value || '').toLowerCase() === 'on';
}

async function runZohoDocuments(): Promise<number> {
  if (zohoMode() === 'disabled') return 0;
  const jobs = claimZohoDocuments(BATCH);
  if (!jobs.length) return 0;
  // allSettled, not all: one document's failure is already recorded on its own
  // row with its own backoff, and must not stop the rest of the batch.
  await Promise.allSettled(jobs.map((job) => processZohoDocument(job.id)));
  return jobs.length;
}

async function runTelegramNotifications(): Promise<number> {
  if (!telegramConfigured()) return 0;
  const jobs = claimTelegramEvents(getDb(), BATCH);
  if (!jobs.length) return 0;
  await Promise.allSettled(jobs.map(processClaimedTelegramEvent));
  return jobs.length;
}

let running = false;

/**
 * One pass over both queues. Exported for tests; never throws, so a bad tick
 * can't take the timer — or the server — down with it.
 */
export async function runScheduledJobs(): Promise<{ zoho: number; telegram: number; skipped?: true }> {
  // A tick that overruns its interval must not be joined by the next one:
  // the claim queries would hand both passes the same rows.
  if (running) return { zoho: 0, telegram: 0, skipped: true };
  running = true;
  try {
    const [zoho, telegram] = await Promise.all([
      runZohoDocuments().catch((error) => { console.error('[jobScheduler] zoho', error); return 0; }),
      runTelegramNotifications().catch((error) => { console.error('[jobScheduler] telegram', error); return 0; }),
    ]);
    return { zoho, telegram };
  } finally {
    running = false;
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Idempotent: repeated imports or calls keep exactly one timer. */
export function startJobScheduler(): boolean {
  if (timer || !schedulerEnabled()) return false;
  timer = setInterval(() => { void runScheduledJobs(); }, TICK_MS);
  timer.unref();
  console.log(`[jobScheduler] started, every ${TICK_MS / 1000}s`);
  return true;
}

startJobScheduler();
