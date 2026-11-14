/**
 * The scheduler is what finally runs the Zoho and Telegram workers, so the
 * properties worth pinning are the ones that keep it from doing harm: it stays
 * off unless switched on (or `astro dev` and the test suites would make real
 * Zoho and Telegram calls), it never lets two passes claim the same rows, and
 * one broken job never takes the tick — or the server — down.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const claimZohoDocuments = vi.fn(() => [] as { id: string }[]);
const processZohoDocument = vi.fn(async () => ({}));
const claimTelegramEvents = vi.fn(() => [] as unknown[]);
const processClaimedTelegramEvent = vi.fn(async () => 'sent');
const runReviewRequests = vi.fn(async () => 0);

vi.mock('../../src/lib/db', () => ({ getDb: () => ({}) }));
vi.mock('../../src/lib/zohoBooks', () => ({
  claimZohoDocuments: (...args: unknown[]) => claimZohoDocuments(...(args as [])),
  processZohoDocument: (...args: unknown[]) => processZohoDocument(...(args as [])),
}));
vi.mock('../../src/lib/paymentLedger', () => ({ zohoMode: () => 'live' }));
vi.mock('../../src/lib/telegram', () => ({
  telegramConfigured: () => true,
  claimTelegramEvents: (...args: unknown[]) => claimTelegramEvents(...(args as [])),
  processClaimedTelegramEvent: (...args: unknown[]) => processClaimedTelegramEvent(...(args as [])),
}));

vi.mock('../../src/lib/tripReviews', () => ({ runReviewRequests: () => runReviewRequests() }));
vi.mock('../../src/lib/emailTransport', () => ({ isEmailConfigured: () => true }));

const { runScheduledJobs, schedulerEnabled, startJobScheduler } = await import('../../src/lib/jobScheduler');

describe('job scheduler', () => {
  beforeEach(() => {
    delete process.env.JOBS_SCHEDULER;
    claimZohoDocuments.mockReset().mockReturnValue([]);
    processZohoDocument.mockReset().mockResolvedValue({});
    claimTelegramEvents.mockReset().mockReturnValue([]);
    processClaimedTelegramEvent.mockReset().mockResolvedValue('sent');
    runReviewRequests.mockReset().mockResolvedValue(0);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => { delete process.env.JOBS_SCHEDULER; });

  it('stays off unless explicitly switched on', () => {
    expect(schedulerEnabled()).toBe(false);
    expect(startJobScheduler()).toBe(false);
    process.env.JOBS_SCHEDULER = 'off';
    expect(schedulerEnabled()).toBe(false);
    process.env.JOBS_SCHEDULER = 'on';
    expect(schedulerEnabled()).toBe(true);
  });

  it('processes a claimed batch from both queues', async () => {
    claimZohoDocuments.mockReturnValue([{ id: 'doc-1' }, { id: 'doc-2' }]);
    claimTelegramEvents.mockReturnValue([{ id: 'ev-1' }]);
    await expect(runScheduledJobs()).resolves.toEqual({ zoho: 2, telegram: 1, reviews: 0 });
    expect(processZohoDocument).toHaveBeenCalledTimes(2);
    expect(processClaimedTelegramEvent).toHaveBeenCalledTimes(1);
  });

  // A tick that outlasts its interval must not be joined by the next one —
  // both passes would claim the same rows.
  it('skips a tick while another is still running', async () => {
    let release: () => void = () => {};
    claimZohoDocuments.mockReturnValue([{ id: 'slow' }]);
    processZohoDocument.mockImplementation(() => new Promise((resolve) => { release = () => resolve({}); }));

    const first = runScheduledJobs();
    const second = await runScheduledJobs();
    expect(second.skipped).toBe(true);
    release();
    await first;

    // And the lock is released, so the pass after it runs normally.
    processZohoDocument.mockResolvedValue({});
    expect((await runScheduledJobs()).skipped).toBeUndefined();
  });

  it('survives a failing job without throwing, and still runs the other queue', async () => {
    claimZohoDocuments.mockImplementation(() => { throw new Error('db is locked'); });
    claimTelegramEvents.mockReturnValue([{ id: 'ev-1' }]);
    await expect(runScheduledJobs()).resolves.toEqual({ zoho: 0, telegram: 1, reviews: 0 });
  });

  it('does not reject when a single document fails', async () => {
    claimZohoDocuments.mockReturnValue([{ id: 'a' }, { id: 'b' }]);
    processZohoDocument.mockRejectedValue(new Error('Zoho OAuth failed'));
    await expect(runScheduledJobs()).resolves.toEqual({ zoho: 2, telegram: 0, reviews: 0 });
  });

  it('sends due review emails, and a failing review job does not stop the others', async () => {
    runReviewRequests.mockResolvedValueOnce(3);
    await expect(runScheduledJobs()).resolves.toMatchObject({ reviews: 3 });
    runReviewRequests.mockRejectedValueOnce(new Error('smtp down'));
    claimTelegramEvents.mockReturnValueOnce([{ id: 1 }]);
    await expect(runScheduledJobs()).resolves.toEqual({ zoho: 0, telegram: 1, reviews: 0 });
  });
});
