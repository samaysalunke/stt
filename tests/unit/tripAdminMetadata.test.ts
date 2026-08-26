import { describe, expect, it } from 'vitest';
import { copiedTripName, withAdminTripUpdate } from '../../src/lib/tripAdminMetadata';

describe('withAdminTripUpdate', () => {
  it('records the supplied admin update time without mutating the trip', () => {
    const trip = { name: 'Test Trip', updatedAt: '2025-01-01T00:00:00.000Z' };
    const now = new Date('2026-08-26T10:30:00.000Z');

    const updated = withAdminTripUpdate(trip, now);

    expect(updated).toEqual({
      name: 'Test Trip',
      updatedAt: '2026-08-26T10:30:00.000Z',
    });
    expect(trip.updatedAt).toBe('2025-01-01T00:00:00.000Z');
  });
});

describe('copiedTripName', () => {
  it('uses the public title so the copied card and editor stay in sync', () => {
    expect(copiedTripName({ title: 'Original Title', name: 'Stale Name' }, 'original-trip'))
      .toBe('Original Title (Copy)');
  });

  it('falls back to the slug when the source has no name', () => {
    expect(copiedTripName({}, 'original-trip')).toBe('original-trip (Copy)');
  });
});
