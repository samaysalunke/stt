/**
 * `recalculateUserLeaderboard` is the only thing that writes leaderboard_cache,
 * and the cache is only refreshed when a booking is created or confirmed — so a
 * row it gets wrong stays wrong until that traveller books again. The cases
 * pinned here are the ones that silently produced a traveller with N trips and
 * nothing to show for them.
 *
 * The database is mocked by routing on SQL rather than seeded, matching the
 * rest of the unit suite, so the real computeStats runs underneath.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Reg = { city: string; trip_name: string; trip_slug: string | null; batch_id: string | null };

const state = {
  user: null as Record<string, unknown> | null,
  regs: [] as Reg[],
};
let written: unknown[] = [];

vi.mock('../../src/lib/db', () => ({
  getDb: () => ({
    prepare: (sql: string) => ({
      get: () => {
        if (/FROM users/.test(sql)) return state.user;
        // The "most recent confirmed booking city" lookup — the only .get() on
        // registrations.
        if (/FROM registrations/.test(sql)) return state.regs.at(-1) ?? null;
        return null;
      },
      all: () => (/FROM registrations/.test(sql) ? state.regs : []),
      run: (...args: unknown[]) => {
        if (/INSERT OR REPLACE INTO leaderboard_cache/.test(sql)) written = args;
        return { changes: 1 };
      },
    }),
  }),
}));

const TRIPS: Record<string, Record<string, unknown>> = {
  'monsoon-meghalaya': {
    title: 'Monsoon Meghalaya',
    location: 'Meghalaya',
    batches: [{ id: 'b1', startDate: '2026-07-10', endDate: '2026-07-16' }],
  },
  'eastern-frontier-arunachal': {
    title: 'Eastern Frontier Arunachal',
    location: 'Arunachal Pradesh',
    batches: [{ id: 'b2', startDate: '2026-11-01', endDate: '2026-11-08' }],
  },
  'last-frontier-arunachal-new-year': {
    title: 'Last Frontier Arunachal',
    location: 'Arunachal Pradesh',
    batches: [{ id: 'b3', startDate: '2026-12-28', endDate: '2027-01-02' }],
  },
};

vi.mock('../../src/lib/content', () => ({
  readTrip: (slug: string) => TRIPS[slug] ?? null,
  findTripByName: (name: string) => {
    const hit = Object.entries(TRIPS).find(([, t]) => t.title === name);
    return hit ? { ...hit[1], slug: hit[0] } : null;
  },
}));

// Every place a traveller books from, and every trip location, resolves — the
// distances themselves are not what these cases are about.
const COORDS: Record<string, { lat: number; lng: number }> = {
  pune: { lat: 18.52, lng: 73.86 },
  meghalaya: { lat: 25.47, lng: 91.37 },
  'arunachal pradesh': { lat: 28.22, lng: 94.73 },
};
vi.mock('../../src/lib/geocode', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/geocode')>('../../src/lib/geocode');
  return {
    ...actual,
    geocodeCity: async (q: string) => COORDS[String(q ?? '').trim().toLowerCase()] ?? null,
  };
});

const { recalculateUserLeaderboard } = await import('../../src/lib/stats');

const USER = {
  id: 'u1', email: 'priya@example.invalid', displayName: 'Priya',
  username: 'priya', avatarUrl: null, homeCityLatLng: null,
};

// Column order of the INSERT: userId, email, displayName, username, avatarUrl,
// homeCityLatLng, kmsFromHome, daysOutdoors, destinationsCount, tripsCount.
const stats = () => ({
  kmsFromHome: written[6] as number,
  daysOutdoors: written[7] as number,
  destinationsCount: written[8] as number,
  tripsCount: written[9] as number,
});

beforeEach(() => {
  state.user = { ...USER };
  state.regs = [];
  written = [];
});

describe('a booking whose trip no longer resolves', () => {
  // trip_slug is a late-added column, so older registrations carry only the
  // title they were booked under. Rename that trip and the title match breaks.
  const ORPHAN: Reg = {
    city: 'Pune', trip_name: 'Monsoon Meghalaya 2024', trip_slug: null, batch_id: 'b1',
  };

  it('still counts towards destinations, under its booked name', async () => {
    state.regs = [ORPHAN];
    await recalculateUserLeaderboard(USER.email);

    // Previously this registration was skipped outright: 1 trip, 0 destinations.
    expect(stats().destinationsCount).toBe(1);
    expect(stats().tripsCount).toBe(1);
  });

  it('contributes no days, having no batch to read them from', async () => {
    state.regs = [ORPHAN];
    await recalculateUserLeaderboard(USER.email);

    // batch_id 'b1' is real, but without a slug there is no trip to look it up
    // in — counting it would mean trusting an id against the wrong trip.
    expect(stats().daysOutdoors).toBe(0);
  });
});

describe('destinations are distinct places, not trips', () => {
  it('counts two trips to the same state once', async () => {
    state.regs = [
      { city: 'Pune', trip_name: 'Eastern Frontier Arunachal', trip_slug: 'eastern-frontier-arunachal', batch_id: 'b2' },
      { city: 'Pune', trip_name: 'Last Frontier Arunachal', trip_slug: 'last-frontier-arunachal-new-year', batch_id: 'b3' },
    ];
    await recalculateUserLeaderboard(USER.email);

    // This is the leaderboard's design, not a defect: the destinations tab
    // ranks places visited while each row prints its trip count beside it, so
    // more trips legitimately reads as fewer destinations.
    expect(stats().destinationsCount).toBe(1);
    expect(stats().tripsCount).toBe(2);
    expect(stats().daysOutdoors).toBe(8 + 6);
  });

  it('matches locations case- and whitespace-insensitively', async () => {
    state.regs = [
      { city: 'Pune', trip_name: '  arunachal PRADESH  ', trip_slug: null, batch_id: null },
      { city: 'Pune', trip_name: 'Arunachal Pradesh', trip_slug: null, batch_id: null },
    ];
    await recalculateUserLeaderboard(USER.email);

    expect(stats().destinationsCount).toBe(1);
  });
});

// The fix is in the SQL, which a routed mock cannot exercise. Both tables carry
// a lower(trim(email)) index precisely because the two disagree on casing; a
// bare `email = ?` here means a traveller who booked as Priya@Gmail.com and
// signed in as priya@gmail.com gets an empty row on every tab.
describe('email is matched on its normalised form', () => {
  const src = readFileSync(path.join(process.cwd(), 'src', 'lib', 'stats.ts'), 'utf-8');

  it('never compares email exactly', () => {
    expect(src).not.toMatch(/\bemail = \?/);
  });
});
