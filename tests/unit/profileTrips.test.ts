import { describe, expect, it } from 'vitest';
import { canonicalizeProfileTrips, groupProfileTrips, indiaDateOnly, shapePublicTrips, todayInIndia, type ProfileRegistrationRow } from '../../src/lib/profileTrips';

const row = (overrides: Partial<ProfileRegistrationRow> = {}): ProfileRegistrationRow => ({
  id: 1, email: ' Person@Example.com ', trip_name: 'Legacy Journey', trip_slug: null,
  trip_date: '2026-09-10', batch_id: null, status: 'lead', created_at: '2026-01-01 10:00:00',
  updated_at: null, status_changed_at: null, ...overrides,
});

describe('profile trip view model', () => {
  it('keeps date-only values stable and computes India today at the UTC boundary', () => {
    expect(indiaDateOnly('2026-09-10')).toBe('2026-09-10');
    expect(todayInIndia(new Date('2026-08-28T20:00:00Z'))).toBe('2026-08-29');
  });

  it('selects a later terminal duplicate over an active record', () => {
    const records = canonicalizeProfileTrips([
      row({ id: 1, status: 'confirmed', status_changed_at: '2026-01-02T00:00:00Z' }),
      row({ id: 2, status: 'cancelled', status_changed_at: '2026-01-03T00:00:00Z', amount_paid: 5000 }),
    ], '2026-01-01');
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe('cancelled');
    expect(records[0].details.amountPaid).toBe(5000);
  });

  it('otherwise applies Confirmed > Pending > Lead > Wishlist and never sums duplicates', () => {
    const [record] = canonicalizeProfileTrips([
      row({ id: 2, status: 'pending', amount_paid: 2000 }),
      row({ id: 1, status: 'confirmed', amount_paid: 3000 }),
    ], '2026-01-01');
    expect(record.status).toBe('confirmed');
    expect(record.details.amountPaid).toBe(3000);
  });

  it('keeps unresolved non-terminal records active and terminal records in history', () => {
    const records = canonicalizeProfileTrips([
      row({ id: 1, trip_date: null, created_at: null, status: 'lead' }),
      row({ id: 2, trip_name: 'Other', trip_date: null, created_at: null, status: 'rejected' }),
    ], '2026-08-28');
    const grouped = groupProfileTrips(records);
    expect(grouped.active.map((r) => r.id)).toContain(1);
    expect(grouped.history.map((r) => r.id)).toContain(2);
  });

  it('uses stored payment status and public shaping excludes private details', () => {
    const [record] = canonicalizeProfileTrips([row({ status:'confirmed', payment_status:'partial_refund', full_name:'Private Name', phone:'999', emergency_name:'Secret' })], '2026-01-01');
    expect(record.paymentStatus).toBe('partial_refund');
    const publicRow = shapePublicTrips([record])[0];
    expect(Object.keys(publicRow).sort()).toEqual(['location','startDate','status','tripName','tripSlug'].sort());
    expect(JSON.stringify(publicRow)).not.toContain('Private Name');
  });
});
