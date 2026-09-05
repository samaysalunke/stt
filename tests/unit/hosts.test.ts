import { describe, expect, test } from 'vitest';
import { parseEditorBooking } from '../../src/lib/tripEditor';

const catalog = JSON.stringify([{ id: 'standard', label: 'Standard', helperText: '' }]);

function departuresWithHosts(hostIds: unknown) {
  return JSON.stringify([
    {
      startDate: '2026-05-03',
      endDate: '2026-05-09',
      status: 'booking-open',
      hostIds,
      offers: [{ tierId: 'standard', price: 31000, cap: 12, booked: 0 }],
    },
  ]);
}

describe('parseEditorBooking hostIds', () => {
  test('round-trips valid slugs', () => {
    const { batches } = parseEditorBooking(catalog, departuresWithHosts(['zahra', 'ankit']));
    expect(batches[0].hostIds).toEqual(['zahra', 'ankit']);
  });

  test('drops slugs that fail the [a-z0-9-] filter', () => {
    const { batches } = parseEditorBooking(catalog, departuresWithHosts(['zahra', 'Ankit Khan', '../etc', '']));
    expect(batches[0].hostIds).toEqual(['zahra']);
  });

  test('defaults to an empty array when absent or malformed', () => {
    expect(parseEditorBooking(catalog, departuresWithHosts(undefined)).batches[0].hostIds).toEqual([]);
    expect(parseEditorBooking(catalog, departuresWithHosts('not-an-array')).batches[0].hostIds).toEqual([]);
  });
});
