import { describe, test, expect, afterEach, vi } from 'vitest';
import { now } from '../../src/lib/clock';

const originalNow = process.env.TEST_NOW;
const originalEnv = process.env.NODE_ENV;

afterEach(() => {
  if (originalNow === undefined) delete process.env.TEST_NOW;
  else process.env.TEST_NOW = originalNow;
  process.env.NODE_ENV = originalEnv;
  vi.useRealTimers();
});

describe('the pinnable clock', () => {
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
});
