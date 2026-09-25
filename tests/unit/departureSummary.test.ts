import { describe, expect, it } from 'vitest';
import { formatDepartureRange, getDepartureSummary } from '../../src/lib/departureSummary';
import type { ResolvedDeparture } from '../../src/lib/trips';

const departure = (id: string, startDate: string, soldOut = false, status = 'booking-open'): ResolvedDeparture => ({
  id, startDate, endDate: startDate, status,
  offers: [], totalCap: null, spotsLeft: null, soldOut,
  comingSoon: status === 'coming-soon',
  fillingFast: status === 'filling_fast' || status === 'filling-fast',
});

describe('formatDepartureRange', () => {
  it.each([
    ['2026-08-30', '2026-09-07', 'Aug 30 – Sep 7'],
    ['2026-12-28', '2027-01-04', 'Dec 28, 2026 – Jan 4, 2027'],
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

  it('excludes departures whose status is not booking-open or coming-soon', () => {
    const result = getDepartureSummary([
      departure('open', '2026-02-01'),
      departure('sold-status', '2026-01-01', true, 'sold-out'),
      departure('closed', '2026-03-01', false, 'registration-closed'),
    ]);
    expect(result.displayed.map(({ id }) => id)).toEqual(['open']);
    expect(result.moreAvailable).toBe(0);
  });

  it('shows coming-soon dates after available ones and counts the overflow', () => {
    const result = getDepartureSummary([
      departure('open', '2026-02-01'),
      departure('cs1', '2026-03-01', false, 'coming-soon'),
      departure('cs2', '2026-04-01', false, 'coming-soon'),
    ]);
    expect(result.displayed.map(({ id }) => id)).toEqual(['open', 'cs1']);
    expect(result.moreAvailable).toBe(1);
  });

  it('includes a filling-fast departure as an available date', () => {
    const result = getDepartureSummary([
      departure('urgent', '2026-02-01', false, 'filling_fast'),
      departure('open', '2026-03-01'),
    ]);
    expect(result.displayed.map(({ id }) => id)).toEqual(['urgent', 'open']);
  });
});
