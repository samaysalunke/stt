import { describe, test, expect, afterEach, vi } from 'vitest';
import { now, todayStart } from '../../src/lib/clock';
import { upcomingBatches } from '../../src/lib/trips';

const originalNow = process.env.TEST_NOW;
const originalEnv = process.env.NODE_ENV;

afterEach(() => {
  if (originalNow === undefined) delete process.env.TEST_NOW;
  else process.env.TEST_NOW = originalNow;
  process.env.NODE_ENV = originalEnv;
  vi.useRealTimers();
});

describe('the pinnable clock', () => {
  test('falls through to the real clock when TEST_NOW is unset', () => {
    delete process.env.TEST_NOW;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T00:00:00.000Z'));
    expect(now()).toBe(Date.parse('2026-07-01T00:00:00.000Z'));
  });

  test('honours TEST_NOW', () => {
    process.env.NODE_ENV = 'test';
    process.env.TEST_NOW = '2026-09-02T12:00:00+05:30';
    expect(now()).toBe(Date.parse('2026-09-02T12:00:00+05:30'));
  });

  test('ignores TEST_NOW in production', () => {
    // The guard that keeps a stray deployed value from freezing the real
    // site's calendar. Mirrors the ALLOW_TEST_CONTENT guard in trips.ts.
    process.env.NODE_ENV = 'production';
    process.env.TEST_NOW = '2000-01-01T00:00:00Z';
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T00:00:00.000Z'));
    expect(now()).toBe(Date.parse('2026-07-01T00:00:00.000Z'));
  });

  test('ignores an unparseable TEST_NOW rather than returning NaN', () => {
    process.env.NODE_ENV = 'test';
    process.env.TEST_NOW = 'not-a-date';
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T00:00:00.000Z'));
    expect(now()).toBe(Date.parse('2026-07-01T00:00:00.000Z'));
  });

  test('todayStart truncates to local midnight', () => {
    process.env.NODE_ENV = 'test';
    process.env.TEST_NOW = '2026-09-02T12:00:00+05:30';
    const d = todayStart();
    expect([d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()]).toEqual([0, 0, 0, 0]);
  });
});

describe('upcomingBatches follows the pinned clock', () => {
  const trip = {
    batches: [
      { id: 'a', startDate: '2026-09-06', status: 'booking-open' },
      { id: 'b', startDate: '2099-01-01', status: 'booking-open' },
    ],
  };

  test('a departure still ahead of TEST_NOW is upcoming', () => {
    process.env.NODE_ENV = 'test';
    process.env.TEST_NOW = '2026-09-02T12:00:00+05:30';
    expect(upcomingBatches(trip).map((b) => b.id)).toEqual(['a', 'b']);
  });

  test('the same departure drops out once TEST_NOW is past it', () => {
    // This is the failure the pin exists to prevent: without it the public
    // baselines change by themselves on 2026-09-07.
    process.env.NODE_ENV = 'test';
    process.env.TEST_NOW = '2026-09-08T12:00:00+05:30';
    expect(upcomingBatches(trip).map((b) => b.id)).toEqual(['b']);
  });
});
