import { describe, test, expect } from 'vitest';
import { editableBooking, parseEditorBooking, parseGallery, matchTierFromStay } from '../../src/lib/tripEditor';

describe('parseGallery', () => {
  test('discards malformed JSON and entries without image paths', () => {
    expect(parseGallery('{broken', { totalLimit: 10, removeDuplicates: true })).toEqual([]);
    expect(parseGallery(JSON.stringify([{ width: 100 }, { image: '  ' }, null]), {
      totalLimit: 10,
      removeDuplicates: true,
    })).toEqual([]);
  });

  test('can remove duplicate URLs and enforce a total limit', () => {
    const input = Array.from({ length: 12 }, (_, index) => ({
      image: `/images/stay/${Math.min(index, 10)}.webp`,
      source: index % 2 ? 'trip' : 'album',
    }));
    const parsed = parseGallery(JSON.stringify(input), { totalLimit: 10, removeDuplicates: true });
    expect(parsed).toHaveLength(10);
    expect(new Set(parsed.map((photo) => photo.image)).size).toBe(10);
  });

  test('retains Trip Photos defaults: album cap only and duplicate URLs allowed', () => {
    const input = [
      ...Array.from({ length: 11 }, (_, index) => ({ image: `/album/${index}.webp`, source: 'album' })),
      { image: '/trip/upload.webp', source: 'trip' },
      { image: '/trip/upload.webp', source: 'trip' },
    ];
    const parsed = parseGallery(JSON.stringify(input));
    expect(parsed).toHaveLength(12);
    expect(parsed.filter((photo) => photo.source === 'album')).toHaveLength(10);
    expect(parsed.filter((photo) => photo.image === '/trip/upload.webp')).toHaveLength(2);
  });
});

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

  test('contains-match strips price suffix', () => {
    expect(matchTierFromStay('Triple sharing - Mudhouse (Rs 22,000)', catalog)).toBe('mudhouse-triple');
  });

  test('no match returns empty string', () => {
    expect(matchTierFromStay('penthouse', catalog)).toBe('');
    expect(matchTierFromStay('', catalog)).toBe('');
  });
});

// ── editableBooking ───────────────────────────────────────────────────────────

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

// ── parseEditorBooking ────────────────────────────────────────────────────────

describe('parseEditorBooking — valid round-trip', () => {
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
