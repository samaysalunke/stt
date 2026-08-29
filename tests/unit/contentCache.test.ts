import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cachedRead, cachedKeys, clearContentCache } from '../../src/lib/contentCache';

const src = (rel: string) => readFileSync(path.join(process.cwd(), 'src', rel), 'utf-8');

describe('contentCache', () => {
  it('serves a second read from the cache without re-running the loader', () => {
    clearContentCache();
    let calls = 0;
    const load = () => { calls++; return { n: calls }; };

    const first = cachedRead('test:hit', load);
    const second = cachedRead('test:hit', load);

    expect(calls).toBe(1);
    expect(second).toBe(first);
  });

  it('keys entries independently', () => {
    clearContentCache();
    cachedRead('test:a', () => 'a');
    cachedRead('test:b', () => 'b');
    expect(cachedKeys().sort()).toEqual(['test:a', 'test:b']);
  });
});

// I5 is unobservable at runtime by design: Node is single-threaded and
// adjustBookingCount is deliberately synchronous, so a behavioural test would
// pass whether or not the invariant held. These are static checks instead —
// they fail the moment someone caches the read half of the read-modify-write.
describe('I5 — the booking read-modify-write is not cached', () => {
  it('readTrip is not wrapped in cachedRead', () => {
    const trips = src('lib/trips.ts');
    const readTripBody = trips.slice(
      trips.indexOf('export function readTrip'),
      trips.indexOf('export function writeTrip'),
    );

    expect(readTripBody).not.toContain('cachedRead');
    // listTrips is the cached one; if this stops being true the assertion above
    // is checking a function that no longer exists.
    expect(trips).toContain("cachedRead('trips'");
  });

  it('adjustBookingCount contains no await', () => {
    const write = src('lib/registrationWrite.ts');
    const body = write.slice(
      write.indexOf('export function adjustBookingCount'),
      write.indexOf('export function confirmedCountForTier'),
    );

    expect(body.length).toBeGreaterThan(0);
    expect(body).not.toMatch(/\bawait\b/);
  });
});
