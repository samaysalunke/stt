/**
 * The coordinates this module caches are used twice over: for the leaderboard's
 * km column, and for the pins on public profile maps. A bad match is therefore
 * visible, not just arithmetic — which is what these cases are about.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const cache = new Map<string, { lat: number; lng: number }>();
const failures = new Map<string, number>();

vi.mock('../../src/lib/db', () => ({
  getDb: () => ({
    prepare: (sql: string) => ({
      get: (q: string) => {
        if (/FROM geocode_cache/.test(sql)) return cache.get(q);
        if (/FROM geocode_failures/.test(sql)) {
          const at = failures.get(q);
          return at === undefined ? undefined : { lastAttemptAt: at };
        }
        return undefined;
      },
      run: (...args: unknown[]) => {
        if (/INSERT OR REPLACE INTO geocode_cache/.test(sql)) {
          cache.set(args[0] as string, { lat: args[1] as number, lng: args[2] as number });
        } else if (/INSERT INTO geocode_failures/.test(sql)) {
          failures.set(args[0] as string, Math.floor(Date.now() / 1000));
        } else if (/DELETE FROM geocode_failures/.test(sql)) {
          failures.delete(args[0] as string);
        }
        return { changes: 1 };
      },
      all: () => [],
    }),
  }),
}));

const { geocodeCity, haversine } = await import('../../src/lib/geocode');

const calls: string[] = [];
const fetchMock = vi.fn(async (url: string) => {
  calls.push(url);
  return { ok: true, json: async () => [{ lat: '12.98', lon: '77.59' }] };
});

beforeEach(() => {
  cache.clear();
  failures.clear();
  calls.length = 0;
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

describe('geocodeCity', () => {
  it('substitutes a known-bad query, but caches under what was asked for', async () => {
    // "Kashmir" alone resolves to a village in Barmer, Rajasthan.
    await geocodeCity('Kashmir', { country: 'India' });
    // URLSearchParams writes spaces as '+'.
    expect(decodeURIComponent(calls[0]).replace(/\+/g, ' ')).toContain('Srinagar, Jammu and Kashmir');
    expect(cache.has('kashmir')).toBe(true);
    expect(cache.has('srinagar, jammu and kashmir')).toBe(false);
  });

  it('records a miss and does not retry it on the next call', async () => {
    fetchMock.mockImplementation(async () => ({ ok: true, json: async () => [] }));

    expect(await geocodeCity('Tumahare dil mein')).toBeNull();
    expect(failures.has('tumahare dil mein')).toBe(true);

    const after = fetchMock.mock.calls.length;
    expect(await geocodeCity('Tumahare dil mein')).toBeNull();
    // The city field is free text, so unresolvable values are common. Retrying
    // each of them on every recalculation spent the 1 req/sec budget on
    // queries already known to fail.
    expect(fetchMock.mock.calls.length).toBe(after);
  });

  it('retries a miss once the window has passed', async () => {
    failures.set('somewhere', Math.floor(Date.now() / 1000) - 8 * 24 * 60 * 60);
    await geocodeCity('Somewhere');
    expect(fetchMock).toHaveBeenCalled();
  });
});

describe('haversine', () => {
  it('measures Mumbai to Srinagar to within a kilometre of the known distance', () => {
    expect(haversine(19.05, 72.87, 34.07, 74.82)).toBeCloseTo(1683, -1);
  });
});
