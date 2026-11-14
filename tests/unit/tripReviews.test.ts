/**
 * Post-trip reviews (src/lib/tripReviews.ts) against a throwaway database and
 * trips folder: who may review, when the email goes out, and that nobody is
 * emailed twice or emailed about a trip that ended long ago.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stt-reviews-'));
process.env.DATA_DIR = path.join(tempDir, 'data');
process.env.CONTENT_DIR = path.join(tempDir, 'content');
fs.mkdirSync(path.join(process.env.CONTENT_DIR, 'trips'), { recursive: true });

const sendTripReviewRequest = vi.fn(async (_: Record<string, string>) => {});
vi.mock('../../src/lib/emailTemplates', () => ({ sendTripReviewRequest: (d: Record<string, string>) => sendTripReviewRequest(d) }));

const trip = (slug: string, batches: string, status = 'published') =>
  fs.writeFileSync(path.join(process.env.CONTENT_DIR!, 'trips', `${slug}.yaml`), `title: ${slug}\npublicationStatus: ${status}\nbatches:\n${batches}`);
trip('spiti', [
  '  - { id: yesterday, startDate: 2026-11-08, endDate: 2026-11-13, status: completed }',
  '  - { id: last-month, startDate: 2026-10-01, endDate: 2026-10-05, status: completed }',
  '  - { id: running, startDate: 2026-11-12, endDate: 2026-11-16, status: booking-open }',
].join('\n'));
trip('qa-fixture', '  - { id: yesterday, startDate: 2026-11-10, endDate: 2026-11-13 }', 'test');

const { getDb } = await import('../../src/lib/db');
const reviews = await import('../../src/lib/tripReviews');

// 14 Nov 2026, India time. The 13 Nov departure ended "yesterday".
const at = (hhmm: string) => new Date(`2026-11-14T${hhmm}:00+05:30`);

function book(over: Record<string, any> = {}): number {
  const r = { email: `t${Math.random().toString(36).slice(2, 8)}@example.invalid`, slug: 'spiti', batch: 'yesterday', status: 'confirmed', ...over };
  return Number(getDb().prepare(`
    INSERT INTO registrations (trip_name, trip_slug, batch_id, full_name, email, phone, emergency_name, emergency_phone, status)
    VALUES ('Spiti', ?, ?, 'Asha Rao', ?, '9999999999', 'x', 'y', ?)
  `).run(r.slug, r.batch, r.email, r.status).lastInsertRowid);
}

beforeAll(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterAll(() => fs.rmSync(tempDir, { recursive: true, force: true }));
beforeEach(() => {
  getDb().exec('DELETE FROM trip_reviews; DELETE FROM registrations;');
  sendTripReviewRequest.mockReset().mockResolvedValue(undefined);
});

describe('the review email', () => {
  it('goes to confirmed travellers the day after the trip ends, from 10am India time', async () => {
    const id = book();
    book({ status: 'pending' });
    book({ status: 'cancelled' });
    book({ batch: 'running' });
    expect(reviews.dueReviewRequests(at('09:59'))).toEqual([]);
    expect(reviews.dueReviewRequests(at('10:00')).map((r) => r.id)).toEqual([id]);

    expect(await reviews.runReviewRequests(at('10:00'))).toBe(1);
    expect(sendTripReviewRequest).toHaveBeenCalledWith(expect.objectContaining({
      firstName: 'Asha', tripName: 'spiti', url: expect.stringMatching(new RegExp(`/profile/review/${id}$`)),
    }));
  });

  it('is sent once, however many passes run', async () => {
    book();
    await reviews.runReviewRequests(at('10:00'));
    await reviews.runReviewRequests(at('11:00'));
    expect(sendTripReviewRequest).toHaveBeenCalledTimes(1);
  });

  it('does not reach back to departures that ended long ago, or QA fixtures', () => {
    book({ batch: 'last-month' });
    book({ slug: 'qa-fixture' });
    expect(reviews.dueReviewRequests(at('12:00'))).toEqual([]);
  });

  it('skips a traveller who already reviewed', () => {
    const id = book();
    reviews.saveReview({ id, trip_slug: 'spiti', batch_id: 'yesterday' }, 'u1', {
      ratings: { overall: 5 }, recommend: null, highlight: '', improve: '', testimonial: '', canFeature: false,
    });
    expect(reviews.dueReviewRequests(at('12:00'))).toEqual([]);
  });

  it('retries a failed send, then gives up after three attempts', async () => {
    const id = book();
    sendTripReviewRequest.mockRejectedValue(new Error('smtp down'));
    for (let i = 0; i < 4; i++) await reviews.runReviewRequests(at('12:00'));
    expect(sendTripReviewRequest).toHaveBeenCalledTimes(3);
    const row = getDb().prepare('SELECT review_requested_at, review_request_attempts, review_request_error FROM registrations WHERE id = ?').get(id) as any;
    expect(row).toMatchObject({ review_requested_at: null, review_request_attempts: 3, review_request_error: 'smtp down' });
  });

  it('can be sent by an admin for an older departure', async () => {
    book({ batch: 'last-month' });
    const pending = reviews.pendingForDeparture('spiti', 'last-month');
    expect(pending).toHaveLength(1);
    expect(await reviews.sendReviewRequest(pending[0])).toBe(true);
    expect(reviews.pendingForDeparture('spiti', 'last-month')).toHaveLength(0);
  });
});

describe('who may review', () => {
  it('only the booking account, only confirmed, only once the trip has ended', () => {
    const id = book({ email: 'Asha@Example.invalid' });
    expect(reviews.reviewAccess(id, 'asha@example.invalid', at('12:00')).ok).toBe(true);
    expect(reviews.reviewAccess(id, 'someone@example.invalid', at('12:00'))).toMatchObject({ ok: false, reason: 'wrong-account' });
    expect(reviews.reviewAccess(book({ email: 'p@example.invalid', status: 'pending' }), 'p@example.invalid', at('12:00'))).toMatchObject({ ok: false, reason: 'not-confirmed' });
    expect(reviews.reviewAccess(book({ email: 'r@example.invalid', batch: 'running' }), 'r@example.invalid', at('12:00'))).toMatchObject({ ok: false, reason: 'not-ended', endDate: '2026-11-16' });
    expect(reviews.reviewAccess(999999, 'asha@example.invalid', at('12:00'))).toMatchObject({ ok: false, reason: 'not-found' });
  });
});

describe('the form', () => {
  const form = (fields: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.set(k, v); return f; };

  it('requires an overall rating and rejects out-of-range values', () => {
    expect(reviews.parseReviewForm(form({})).errors).toContain('Please give the trip an overall rating.');
    expect(reviews.parseReviewForm(form({ overall: '6' })).errors.length).toBeGreaterThan(0);
    expect(reviews.parseReviewForm(form({ overall: '4', recommend: '11' })).errors.length).toBeGreaterThan(0);
    const ok = reviews.parseReviewForm(form({ overall: '4', food: '3', recommend: '0', highlight: '  Hanle skies  ', canFeature: 'on' }));
    expect(ok.errors).toEqual([]);
    expect(ok.input).toMatchObject({ ratings: { overall: 4, food: 3, stay: null }, recommend: 0, highlight: 'Hanle skies', canFeature: true });
  });

  it('saves, updates, and keeps "feature it" only alongside a quote', () => {
    const id = book();
    const base = { ratings: { overall: 3 }, recommend: 7, highlight: 'a', improve: 'b', testimonial: '', canFeature: true };
    reviews.saveReview({ id, trip_slug: 'spiti', batch_id: 'yesterday' }, 'u1', base);
    let row = getDb().prepare('SELECT * FROM trip_reviews WHERE registration_id = ?').get(id) as any;
    expect(row).toMatchObject({ overall_rating: 3, recommend_score: 7, can_feature: 0 });
    reviews.saveReview({ id, trip_slug: 'spiti', batch_id: 'yesterday' }, 'u1', { ...base, ratings: { overall: 5 }, testimonial: 'Go.' });
    row = getDb().prepare('SELECT * FROM trip_reviews WHERE registration_id = ?').get(id) as any;
    expect(row).toMatchObject({ overall_rating: 5, testimonial: 'Go.', can_feature: 1 });
    expect((getDb().prepare('SELECT COUNT(*) n FROM trip_reviews').get() as any).n).toBe(1);
  });
});

describe('admin numbers', () => {
  it('computes NPS from 0–10 answers', () => {
    expect(reviews.npsScore([])).toBeNull();
    expect(reviews.npsScore([10, 9, 8, 6])).toBe(25);
    expect(reviews.npsScore([0, 3, null])).toBe(-100);
  });

  it('summarises ended departures, scoped for a trip lead', () => {
    const a = book();
    book();
    book({ batch: 'running' });
    reviews.saveReview({ id: a, trip_slug: 'spiti', batch_id: 'yesterday' }, 'u1', {
      ratings: { overall: 4 }, recommend: 10, highlight: '', improve: '', testimonial: '', canFeature: false,
    });
    const all = reviews.departureReviewSummaries(null, at('12:00'));
    expect(all).toEqual([expect.objectContaining({ batchId: 'yesterday', travellers: 2, reviews: 1, avgOverall: 4, nps: 100 })]);
    expect(reviews.departureReviewSummaries(['other'], at('12:00'))).toEqual([]);
    expect(reviews.departureReviews('spiti', 'yesterday').map((r) => r.review_id != null)).toEqual([true, false]);
  });
});
