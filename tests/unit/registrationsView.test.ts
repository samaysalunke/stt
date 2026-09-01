import { describe, expect, it } from 'vitest';
import { isHistoricalDeparture } from '../../src/lib/registrationsView';

const today = new Date('2026-09-01T12:00:00+05:30');

describe('registrations view history', () => {
  it('keeps a future sold-out departure out of history', () => {
    expect(isHistoricalDeparture({
      startDate: '2026-09-15',
      status: 'sold-out',
    }, today)).toBe(false);
  });

  it('treats a past departure as history regardless of availability', () => {
    expect(isHistoricalDeparture({
      startDate: '2026-08-31',
      status: 'booking-open',
    }, today)).toBe(true);
  });

  it.each(['completed', 'draft'])('treats an explicitly %s departure as history', (status) => {
    expect(isHistoricalDeparture({
      startDate: '2026-09-15',
      status,
    }, today)).toBe(true);
  });
});
