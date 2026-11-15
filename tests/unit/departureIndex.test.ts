import { describe, expect, it } from 'vitest';
import {
  buildDepartureIndex,
  departureKey,
  holdsSeatOn,
  memoAlias,
  placeDeparture,
} from '../../src/lib/departureIndex';
import { placeRegistrations } from '../../src/lib/registrationsView';
import { freshBatchIds } from '../../src/lib/tripAdminMetadata';

// The shape that broke production: a trip, its duplicate that kept the same
// batch ids, and registrations booked under a slug the trip has since left.
const index = buildDepartureIndex([
  { tripSlug: 'goa', batchId: 'goa-sep' },
  { tripSlug: 'goa', batchId: '2026-10-22' },
  { tripSlug: 'goa-copy', batchId: 'goa-sep' },
  { tripSlug: 'goa-copy', batchId: '2026-10-22' },
  { tripSlug: 'ladakh', batchId: 'ladakh-jun' },
]);
const alias = (slug: string) => (slug === 'goa-old' ? 'goa' : null);

describe('placeDeparture', () => {
  it('keeps a shared batch id on the trip the row was booked under', () => {
    expect(placeDeparture(index, 'goa', 'goa-sep', alias)).toBe(departureKey('goa', 'goa-sep'));
    expect(placeDeparture(index, 'goa-copy', 'goa-sep', alias)).toBe(departureKey('goa-copy', 'goa-sep'));
  });

  it('follows a renamed trip', () => {
    expect(placeDeparture(index, 'goa-old', 'goa-sep', alias)).toBe(departureKey('goa', 'goa-sep'));
  });

  it('refuses to guess between trips sharing a batch id', () => {
    expect(placeDeparture(index, null, 'goa-sep', alias)).toBeNull();
    expect(placeDeparture(index, 'deleted-trip', 'goa-sep', alias)).toBeNull();
  });

  it('places a slugless row when the batch id is unambiguous', () => {
    expect(placeDeparture(index, null, 'ladakh-jun', alias)).toBe(departureKey('ladakh', 'ladakh-jun'));
    expect(placeDeparture(index, 'deleted-trip', 'ladakh-jun', alias)).toBe(departureKey('ladakh', 'ladakh-jun'));
  });

  it('cannot place a row with no batch or an unknown one', () => {
    expect(placeDeparture(index, 'goa', '', alias)).toBeNull();
    expect(placeDeparture(index, 'goa', 'nope', alias)).toBeNull();
  });
});

describe('placeRegistrations', () => {
  it('gives each trip only its own bookings', () => {
    const regs = [
      { id: 1, trip_slug: 'goa-old', batch_id: 'goa-sep' },
      { id: 2, trip_slug: 'goa-copy', batch_id: 'goa-sep' },
      { id: 3, trip_slug: 'goa', batch_id: '2026-10-22' },
      { id: 4, trip_slug: null, batch_id: 'goa-sep' },
      { id: 5, trip_slug: 'goa', batch_id: null },
    ];
    const { regsByDeparture, unplaced } = placeRegistrations(regs, index, alias);
    const ids = (slug: string, batch: string) =>
      (regsByDeparture.get(departureKey(slug, batch)) ?? []).map((r) => r.id);
    expect(ids('goa', 'goa-sep')).toEqual([1]);
    expect(ids('goa-copy', 'goa-sep')).toEqual([2]);
    expect(ids('goa', '2026-10-22')).toEqual([3]);
    expect(ids('goa-copy', '2026-10-22')).toEqual([]);
    expect(unplaced.map((r) => r.id)).toEqual([4, 5]);
  });
});

describe('holdsSeatOn', () => {
  it("does not charge a copy with its source's seats", () => {
    expect(holdsSeatOn(index, 'goa-copy', 'goa-sep', 'goa-old', alias)).toBe(false);
    expect(holdsSeatOn(index, 'goa-copy', 'goa-sep', 'goa-copy', alias)).toBe(true);
    expect(holdsSeatOn(index, 'goa', 'goa-sep', 'goa-old', alias)).toBe(true);
    expect(holdsSeatOn(index, 'goa', 'goa-sep', 'goa-copy', alias)).toBe(false);
  });

  it('counts a row it cannot place, so the error is never an oversold room', () => {
    expect(holdsSeatOn(index, 'goa', 'goa-sep', null, alias)).toBe(true);
    expect(holdsSeatOn(index, 'goa-copy', 'goa-sep', null, alias)).toBe(true);
    expect(holdsSeatOn(index, 'goa', 'goa-sep', 'deleted-trip', alias)).toBe(true);
  });
});

describe('memoAlias', () => {
  it('looks each slug up once', () => {
    let calls = 0;
    const resolve = memoAlias((slug) => { calls++; return slug === 'a' ? 'b' : null; });
    expect([resolve('a'), resolve('a'), resolve('x'), resolve('x')]).toEqual(['b', 'b', null, null]);
    expect(calls).toBe(2);
  });
});

describe('freshBatchIds', () => {
  it("never reuses the source trip's departure ids", () => {
    const ids = freshBatchIds('goa-copy', [
      { id: 'goa-sep', startDate: '2026-09-10' },
      { id: '2026-10-22', startDate: '2026-10-22' },
    ]);
    expect(ids).toEqual(['goa-copy-2026-09-10', 'goa-copy-2026-10-22']);
  });

  it('stays unique when two departures share a start date or have none', () => {
    const ids = freshBatchIds('t', [{ startDate: '2026-01-01' }, { startDate: '2026-01-01' }, {}, {}]);
    expect(new Set(ids).size).toBe(4);
    expect(ids[1]).toBe('t-2026-01-01-2');
  });
});
