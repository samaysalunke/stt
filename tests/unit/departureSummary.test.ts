import { describe, expect, it } from 'vitest';
import { formatDepartureRange, getDepartureSummary } from '../../src/lib/departureSummary';
import type { ResolvedDeparture } from '../../src/lib/trips';

const departure = (id: string, startDate: string, soldOut = false, status = 'booking-open'): ResolvedDeparture => ({
  id, startDate, endDate: startDate, status,
  offers: [], totalCap: null, spotsLeft: null, soldOut,
});

describe('formatDepartureRange', () => {
  it.each([
    ['2026-08-12', '2026-08-20', 'Aug 12 – 20'],
    ['2026-08-30', '2026-09-07', 'Aug 30 – Sep 7'],
    ['2026-12-28', '2027-01-04', 'Dec 28, 2026 – Jan 4, 2027'],
    ['2026-08-12', '2026-08-12', 'Aug 12'],
  ])('formats %s through %s', (start, end, expected) => {
    expect(formatDepartureRange(start, end)).toBe(expected);
  });
});

describe('getDepartureSummary', () => {
  it('prioritizes two available dates and counts undisplayed available dates', () => {
    const result = getDepartureSummary([
      departure('sold', '2026-01-01', true), departure('third', '2026-04-01'),
      departure('second', '2026-03-01'), departure('first', '2026-02-01'),
    ]);
    expect(result.displayed.map(({ id }) => id)).toEqual(['first', 'second']);
    expect(result.moreAvailable).toBe(1);
  });

  it('fills empty positions with the earliest sold-out dates', () => {
    const result = getDepartureSummary([
      departure('sold-later', '2026-03-01', true), departure('available', '2026-04-01'),
      departure('sold-first', '2026-02-01', true),
    ]);
    expect(result.displayed.map(({ id }) => id)).toEqual(['available', 'sold-first']);
    expect(result.moreAvailable).toBe(0);
  });

  it('excludes departures whose status is not booking-open', () => {
    const result = getDepartureSummary([
      departure('open', '2026-02-01'),
      departure('sold-status', '2026-01-01', true, 'sold-out'),
      departure('closed', '2026-03-01', false, 'registration-closed'),
    ]);
    expect(result.displayed.map(({ id }) => id)).toEqual(['open']);
    expect(result.moreAvailable).toBe(0);
  });
});
