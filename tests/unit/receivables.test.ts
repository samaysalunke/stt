import { describe, expect, it } from 'vitest';
import {
  bucketReceivable,
  businessToday,
  summariseReceivables,
  type ReceivableInput,
} from '../../src/lib/receivables';
import type { DepartureMeta } from '../../src/lib/departureFinance';

const TODAY = '2026-09-15';

const departure = (over: Partial<DepartureMeta> = {}): DepartureMeta => ({
  tripSlug: 'ladakh', tripName: 'Ladakh', batchId: 'ladakh-2026-10',
  // Far enough out that nothing is overdue unless a test says so.
  startDate: '2026-10-20', endDate: '2026-10-28', status: 'booking-open',
  lowestOfferPrice: 35000, capacity: 15, balanceDueRule: '15 days before trip',
  ...over,
});

const booking = (over: Partial<ReceivableInput> = {}): ReceivableInput => ({
  registrationId: 1, fullName: 'A Traveller', tripName: 'Ladakh',
  tripSlug: 'ladakh', batchId: 'ladakh-2026-10',
  totalAmount: 35000, amountPaid: 10000, createdAt: '2026-01-01',
  ...over,
});

const bucketOf = (b: Partial<ReceivableInput>, d: Partial<DepartureMeta> | null = {}) =>
  bucketReceivable(booking(b), d === null ? null : departure(d), TODAY).bucket;

describe('bucketReceivable', () => {
  it('computes the balance owed', () => {
    const row = bucketReceivable(booking(), departure(), TODAY);
    expect(row.balance).toBe(25000);
    expect(row.dueDate).toBe('2026-10-05'); // 20 Oct minus 15 days
  });

  it('clamps an overpayment to zero rather than a negative receivable', () => {
    const row = bucketReceivable(booking({ amountPaid: 50000 }), departure(), TODAY);
    expect(row.balance).toBe(0);
  });

  describe('ageing bands', () => {
    it('is due-soon within seven days of the due date', () => {
      expect(bucketOf({}, { startDate: '2026-10-03' })).toBe('due-soon');   // due 18 Sep
    });

    it('is not-yet-due beyond seven days', () => {
      expect(bucketOf({}, { startDate: '2026-10-10' })).toBe('not-yet-due'); // due 25 Sep
    });

    /**
     * A 90-day rule, so the departure stays in the FUTURE while the due date is
     * far in the past. With the usual 10-15 day rule these deep bands are
     * unreachable pre-departure — the trip has already run, and the row belongs
     * in post-departure instead. That is the reason the bands are 15/30/60
     * rather than the invoice-cycle 30/60/90.
     */
    it.each([
      ['2026-12-13', 1, 'overdue-0-15'],
      ['2026-11-29', 15, 'overdue-0-15'],     // boundary
      ['2026-11-28', 16, 'overdue-16-30'],
      ['2026-11-14', 30, 'overdue-16-30'],    // boundary
      ['2026-11-13', 31, 'overdue-31-60'],
      ['2026-10-15', 60, 'overdue-31-60'],    // boundary
      ['2026-10-14', 61, 'overdue-60-plus'],
    ])('start %s is %i days overdue -> %s', (startDate, days, expected) => {
      const row = bucketReceivable(
        booking(),
        departure({ startDate, balanceDueRule: '90 days before trip' }),
        TODAY,
      );
      expect(row.daysOverdue).toBe(days);
      expect(row.bucket).toBe(expected);
    });

    it('sends a short-rule balance past its departure to post-departure, not a deep band', () => {
      // 15-day rule, 61 days past due => the trip ran 46 days ago.
      expect(bucketOf({}, { startDate: '2026-07-31' })).toBe('post-departure');
    });
  });

  it('puts a departure that has already run in its own bucket, not an ageing band', () => {
    const row = bucketReceivable(booking(), departure({ startDate: '2026-06-01', status: 'completed' }), TODAY);
    expect(row.bucket).toBe('post-departure');
  });

  it('treats a past date as post-departure even when the status was never updated', () => {
    expect(bucketOf({}, { startDate: '2026-05-01', status: 'booking-open' })).toBe('post-departure');
  });

  it('clamps days overdue to the age of the booking', () => {
    // A 60-day rule on a trip 10 days away is overdue the moment it is booked.
    const row = bucketReceivable(
      booking({ createdAt: '2026-09-12' }),
      departure({ startDate: '2026-09-25', balanceDueRule: '60 days before trip' }),
      TODAY,
    );
    // Raw would be 2026-09-15 minus 2026-07-27 = 50 days; the booking is 3 days old.
    expect(row.daysOverdue).toBe(3);
    expect(row.bucket).toBe('overdue-0-15');
  });

  it('surfaces an unknown contract value instead of letting it read as paid', () => {
    expect(bucketOf({ totalAmount: null })).toBe('unknown-value');
    expect(bucketOf({ totalAmount: 0 })).toBe('unknown-value');
  });

  it('does not invent a due date when the rule states no day count', () => {
    expect(bucketOf({}, { balanceDueRule: 'due on arrival' })).toBe('no-due-date');
  });

  it('flags a booking that matches no departure', () => {
    expect(bucketOf({}, null)).toBe('unlinked');
  });
});

describe('summariseReceivables', () => {
  const row = (bucket: string, balance: number) =>
    ({ bucket, balance } as any);

  it('counts only aged buckets toward the aged total', () => {
    const summary = summariseReceivables([
      row('post-departure', 10_000),
      row('overdue-0-15', 5_000),
      row('not-yet-due', 90_000),
      row('unknown-value', 0),
    ]);
    expect(summary.agedTotal).toBe(15_000);
    expect(summary.total).toBe(105_000);
  });

});

describe('businessToday', () => {
  it('uses the business timezone, not the host timezone', () => {
    // 19:30 UTC is already the next day in IST.
    expect(businessToday(new Date('2026-09-15T19:30:00Z'))).toBe('2026-09-16');
    expect(businessToday(new Date('2026-09-15T17:00:00Z'))).toBe('2026-09-15');
  });
});
