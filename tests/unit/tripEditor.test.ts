import { describe, test, expect } from 'vitest';
import { editableBooking, parseEditorBooking, matchTierFromStay, normalizeTierText } from '../../src/lib/tripEditor';

describe('matchTierFromStay', () => {
  const catalog = [
    { id: 'mudhouse-triple', label: 'Mudhouse Triple', helperText: '' },
    { id: 'swiss-double', label: 'Swiss Tent Double', helperText: '' },
    { id: 'dorm', label: 'Dorm', helperText: '' },
  ];

  test('exact match on id (case/space-insensitive)', () => {
    expect(matchTierFromStay('mudhouse triple', catalog)).toBe('mudhouse-triple');
    expect(matchTierFromStay('Mudhouse-Triple', catalog)).toBe('mudhouse-triple');
  });

  test('exact match on label', () => {
    expect(matchTierFromStay('Swiss Tent Double', catalog)).toBe('swiss-double');
  });

  test('contains-match strips price suffix', () => {
    expect(matchTierFromStay('Triple sharing - Mudhouse (Rs 22,000)', catalog)).toBe('mudhouse-triple');
  });

  test('no match returns empty string', () => {
    expect(matchTierFromStay('penthouse', catalog)).toBe('');
    expect(matchTierFromStay('', catalog)).toBe('');
  });

  test('normalizeTierText drops price and punctuation', () => {
    expect(normalizeTierText('Triple sharing - Mudhouse (Rs 22,000)')).toBe('triple sharing mudhouse');
  });
});

// ── editableBooking ───────────────────────────────────────────────────────────

describe('editableBooking — new schema pass-through', () => {
  const trip = {
    occupancyCatalog: [
      { id: 'dorm', label: 'Dorm Bed', helperText: 'Shared room.' },
      { id: 'private', label: 'Private Room', helperText: '' },
    ],
    batches: [
      {
        id: 'dep-1',
        startDate: '2099-01-01',
        endDate: '2099-01-05',
        status: 'booking-open',
        offers: [
          { tierId: 'dorm', price: 5000, cap: 12, booked: 2 },
          { tierId: 'private', price: 7000, cap: 3, booked: 0 },
        ],
      },
    ],
  };

  test('catalog passes through with id, label, helperText', () => {
    const { editorCatalog } = editableBooking(trip);
    expect(editorCatalog).toHaveLength(2);
    expect(editorCatalog[0]).toEqual({ id: 'dorm', label: 'Dorm Bed', helperText: 'Shared room.' });
  });

  test('departure offers pass through with correct numeric fields', () => {
    const { editorDepartures } = editableBooking(trip);
    expect(editorDepartures).toHaveLength(1);
    const offers = editorDepartures[0].offers;
    expect(offers).toHaveLength(2);
    expect(offers[0]).toMatchObject({ tierId: 'dorm', price: 5000, cap: 12, booked: 2 });
  });

  test('departure metadata (id, startDate, endDate, status) is preserved', () => {
    const { editorDepartures } = editableBooking(trip);
    expect(editorDepartures[0]).toMatchObject({
      id: 'dep-1',
      startDate: '2099-01-01',
      endDate: '2099-01-05',
      status: 'booking-open',
    });
  });
});

describe('editableBooking — legacy sharingOptions synthesis', () => {
  const trip = {
    sharingOptions: [
      { id: 'triple', label: 'Triple Sharing', price: 29000 },
      { id: 'double', label: 'Double Sharing', price: 31000 },
    ],
    batches: [
      {
        id: 'dep-1',
        startDate: '2099-01-01',
        endDate: '2099-01-05',
        status: 'booking-open',
        totalSpots: 15,
        bookedSpots: 3,
      },
    ],
  };

  test('catalog derived from sharingOptions', () => {
    const { editorCatalog } = editableBooking(trip);
    expect(editorCatalog).toHaveLength(2);
    expect(editorCatalog[0].id).toBe('triple');
    expect(editorCatalog[1].id).toBe('double');
  });

  test('each sharing tier synthesized into an offer on the departure', () => {
    const { editorDepartures } = editableBooking(trip);
    expect(editorDepartures[0].offers).toHaveLength(2);
    expect(editorDepartures[0].offers[0].tierId).toBe('triple');
    expect(editorDepartures[0].offers[0].price).toBe(29000);
  });

  test('legacy batch stock is assigned to each synthesized offer', () => {
    const { editorDepartures } = editableBooking(trip);
    const offer = editorDepartures[0].offers[0];
    expect(offer.cap).toBe(15);
    expect(offer.booked).toBe(3);
  });
});

describe('editableBooking — no departures', () => {
  test('empty batches → empty editorDepartures', () => {
    const { editorDepartures } = editableBooking({ batches: [] });
    expect(editorDepartures).toHaveLength(0);
  });

  test('no batches field → empty editorDepartures', () => {
    const { editorDepartures } = editableBooking({});
    expect(editorDepartures).toHaveLength(0);
  });

  test('no occupancyCatalog → single standard tier in catalog', () => {
    const { editorCatalog } = editableBooking({ batches: [] });
    expect(editorCatalog).toHaveLength(1);
    expect(editorCatalog[0].id).toBe('standard');
  });
});

// ── parseEditorBooking ────────────────────────────────────────────────────────

describe('parseEditorBooking — valid round-trip', () => {
  const catalogJson = JSON.stringify([
    { id: 'dorm', label: 'Dorm Bed', helperText: 'Shared room.' },
    { id: 'private', label: 'Private Room', helperText: '' },
  ]);
  const departuresJson = JSON.stringify([
    {
      id: 'dep-1',
      startDate: '2099-01-01',
      endDate: '2099-01-05',
      status: 'booking-open',
      offers: [
        { tierId: 'dorm', price: 5000, cap: 12, booked: 2 },
        { tierId: 'private', price: 7000, cap: 3, booked: 0 },
      ],
    },
  ]);

  test('occupancyCatalog has correct entries', () => {
    const { occupancyCatalog } = parseEditorBooking(catalogJson, departuresJson);
    expect(occupancyCatalog).toHaveLength(2);
    expect(occupancyCatalog[0]).toMatchObject({ id: 'dorm', label: 'Dorm Bed' });
  });

  test('batches has correct departure with offers', () => {
    const { batches } = parseEditorBooking(catalogJson, departuresJson);
    expect(batches).toHaveLength(1);
    expect(batches[0].id).toBe('dep-1');
    expect(batches[0].offers).toHaveLength(2);
    expect(batches[0].offers[0]).toMatchObject({ tierId: 'dorm', price: 5000 });
  });

  test('price is rounded to integer', () => {
    const catJson = JSON.stringify([{ id: 'std', label: 'Standard', helperText: '' }]);
    const depJson = JSON.stringify([
      {
        id: 'dep-1',
        startDate: '2099-01-01',
        endDate: '2099-01-05',
        status: 'booking-open',
        offers: [{ tierId: 'std', price: 5000.99, cap: 10, booked: 0 }],
      },
    ]);
    const { batches } = parseEditorBooking(catJson, depJson);
    expect(batches[0].offers[0].price).toBe(5001);
  });

  test('null cap is preserved as null', () => {
    const catJson = JSON.stringify([{ id: 'std', label: 'Standard', helperText: '' }]);
    const depJson = JSON.stringify([
      {
        id: 'dep-1',
        startDate: '2099-01-01',
        endDate: '2099-01-05',
        status: 'booking-open',
        offers: [{ tierId: 'std', price: 5000, cap: null, booked: 0 }],
      },
    ]);
    const { batches } = parseEditorBooking(catJson, depJson);
    expect(batches[0].offers[0].cap).toBeNull();
  });

  test('departure discount amount and expiry round-trip as normalized values', () => {
    const catJson = JSON.stringify([{ id: 'std', label: 'Standard', helperText: '' }]);
    const depJson = JSON.stringify([{
      id: 'dep-discount',
      startDate: '2099-01-01',
      endDate: '2099-01-05',
      status: 'booking-open',
      discountAmount: 1500.4,
      discountEndsAt: '2098-12-15T18:30:00+05:30',
      offers: [{ tierId: 'std', price: 5000, cap: 10, booked: 0 }],
    }]);
    const { batches } = parseEditorBooking(catJson, depJson);
    expect(batches[0].discountAmount).toBe(1500);
    expect(batches[0].discountEndsAt).toBe('2098-12-15T13:00:00.000Z');
  });

  test('expiry is discarded when no positive discount is configured', () => {
    const catJson = JSON.stringify([{ id: 'std', label: 'Standard', helperText: '' }]);
    const depJson = JSON.stringify([{
      id: 'dep-no-discount', startDate: '2099-01-01', endDate: '2099-01-05',
      discountAmount: 0, discountEndsAt: '2098-12-15T13:00:00.000Z',
      offers: [{ tierId: 'std', price: 5000, cap: 10, booked: 0 }],
    }]);
    const { batches } = parseEditorBooking(catJson, depJson);
    expect(batches[0].discountAmount).toBeNull();
    expect(batches[0].discountEndsAt).toBeNull();
  });

  test('null expiry keeps a positive discount open-ended', () => {
    const catJson = JSON.stringify([{ id: 'std', label: 'Standard', helperText: '' }]);
    const depJson = JSON.stringify([{
      id: 'dep-open-sale', startDate: '2099-01-01', endDate: '2099-01-05',
      discountAmount: 500, discountEndsAt: null,
      offers: [{ tierId: 'std', price: 5000, cap: 10, booked: 0 }],
    }]);
    const { batches } = parseEditorBooking(catJson, depJson);
    expect(batches[0].discountAmount).toBe(500);
    expect(batches[0].discountEndsAt).toBeNull();
  });

  test('zero is accepted as an intentional price', () => {
    const catJson = JSON.stringify([{ id: 'std', label: 'Standard', helperText: '' }]);
    const depJson = JSON.stringify([
      {
        id: 'dep-1',
        startDate: '2099-01-01',
        endDate: '2099-01-05',
        status: 'booking-open',
        offers: [{ tierId: 'std', price: 0, cap: 10, booked: 0 }],
      },
    ]);
    const { batches, errors } = parseEditorBooking(catJson, depJson);
    expect(errors).toEqual([]);
    expect(batches[0].offers[0].price).toBe(0);
  });
});

describe('parseEditorBooking — malformed input', () => {
  test('malformed catalogJson → empty occupancyCatalog (does not throw)', () => {
    const { occupancyCatalog, batches, errors } = parseEditorBooking('NOT JSON', '[]');
    expect(occupancyCatalog).toHaveLength(0);
    expect(batches).toHaveLength(0);
    expect(errors).toContainEqual({ code: 'invalid-catalog' });
  });

  test('malformed departuresJson → empty batches (does not throw)', () => {
    const catJson = JSON.stringify([{ id: 'std', label: 'Standard', helperText: '' }]);
    const { batches, errors } = parseEditorBooking(catJson, 'NOT JSON');
    expect(batches).toHaveLength(0);
    expect(errors).toContainEqual({ code: 'invalid-departures' });
  });

  test('offer tierId not in catalog is filtered out', () => {
    const catJson = JSON.stringify([{ id: 'economy', label: 'Economy', helperText: '' }]);
    const depJson = JSON.stringify([
      {
        id: 'dep-1',
        startDate: '2099-01-01',
        endDate: '2099-01-05',
        status: 'booking-open',
        offers: [
          { tierId: 'economy', price: 5000, cap: 10, booked: 0 },
          { tierId: 'nonexistent-tier', price: 9000, cap: 5, booked: 0 },
        ],
      },
    ]);
    const { batches } = parseEditorBooking(catJson, depJson);
    expect(batches[0].offers).toHaveLength(1);
    expect(batches[0].offers[0].tierId).toBe('economy');
  });

  test('departure with no valid offers is filtered out', () => {
    const catJson = JSON.stringify([{ id: 'economy', label: 'Economy', helperText: '' }]);
    const depJson = JSON.stringify([
      {
        id: 'dep-1',
        startDate: '2099-01-01',
        endDate: '2099-01-05',
        status: 'booking-open',
        offers: [], // no valid offers
      },
    ]);
    const { batches, errors } = parseEditorBooking(catJson, depJson);
    expect(batches).toHaveLength(0);
    expect(errors).toContainEqual({ code: 'missing-offer', departureIndex: 0 });
  });

  test('departure with a blank selected-offer price is rejected', () => {
    const catJson = JSON.stringify([{ id: 'economy', label: 'Economy', helperText: '' }]);
    const depJson = JSON.stringify([
      {
        id: 'dep-1',
        startDate: '2099-01-01',
        endDate: '2099-01-05',
        status: 'booking-open',
        offers: [{ tierId: 'economy', price: null, cap: 10, booked: 0 }],
      },
    ]);
    const { batches, errors } = parseEditorBooking(catJson, depJson);
    expect(batches).toHaveLength(0);
    expect(errors).toContainEqual({ code: 'missing-price', departureIndex: 0 });
  });

  test('departure without a start date is rejected', () => {
    const catJson = JSON.stringify([{ id: 'economy', label: 'Economy', helperText: '' }]);
    const depJson = JSON.stringify([
      {
        id: '',
        startDate: '',
        endDate: '',
        status: 'booking-open',
        offers: [{ tierId: 'economy', price: 5000, cap: 10, booked: 0 }],
      },
    ]);
    const { batches, errors } = parseEditorBooking(catJson, depJson);
    expect(batches).toHaveLength(0);
    expect(errors).toContainEqual({ code: 'missing-start-date', departureIndex: 0 });
  });
});
