import { describe, expect, it } from 'vitest';
import type { ProfileTripRecord } from '../../src/lib/profileTrips';
import { balanceDue, tripPrimaryAction, tripStates, unfinishedBooking, upcomingTrips } from '../../src/lib/userTrips';

const record = (over: Partial<ProfileTripRecord> = {}, details: Partial<ProfileTripRecord['details']> = {}): ProfileTripRecord => ({
  id: 1, tripName: 'Spiti', tripSlug: 'spiti', batchId: 'oct', tripExists: true,
  startDate: '2026-11-01', endDate: '2026-11-07', dateLabel: '1–7 Nov 2026', timingLabel: 'Starts in 20 days',
  coverImage: null, period: 'upcoming', status: 'confirmed', statusLabel: 'Confirmed',
  paymentStatus: 'partial', paymentLabel: 'Partly paid', bookable: true, location: null, changedAt: 0,
  ...over,
  details: {
    occupancy: null, totalAmount: 20000, amountPaid: 5000, balance: 15000, balanceDueDate: '2026-10-17',
    balanceDueRule: '15 days before trip', daysOverdue: -5, balanceActionable: false, balanceReportedAt: null,
    amountRefunded: 0,
    traveller: { name: null, phone: null, age: null, gender: null, cityState: null, instagram: null, emergencyContact: null, whyJoin: null },
    ...details,
  },
});

describe('tripPrimaryAction', () => {
  it('asks for the balance when it is actionable', () => {
    expect(tripPrimaryAction(record({}, { balanceActionable: true }))).toEqual({ href: '/profile/pay/1', label: 'Pay balance', kind: 'pay' });
  });
  it('never asks again once the traveller reported paying', () => {
    expect(tripPrimaryAction(record({}, { balanceActionable: true, balanceReportedAt: '2026-10-01' }))).toBeNull();
  });
  it('offers to continue an unfinished booking on a bookable departure', () => {
    expect(tripPrimaryAction(record({ status: 'lead' }))).toEqual({ href: '/trips/spiti/book?batch=oct', label: 'Continue booking', kind: 'continue' });
    expect(tripPrimaryAction(record({ status: 'lead', bookable: false }))).toBeNull();
  });
  it('sends a wishlist entry to the trip page, only while the trip exists', () => {
    expect(tripPrimaryAction(record({ status: 'wishlist' }))?.href).toBe('/trips/spiti/');
    expect(tripPrimaryAction(record({ status: 'wishlist', tripExists: false }))).toBeNull();
  });
  it('gives a confirmed booking with nothing owed no filled action', () => {
    expect(tripPrimaryAction(record())).toBeNull();
  });
});

describe('trip selection', () => {
  const soon = record({ id: 2, startDate: '2026-10-20' });
  const later = record({ id: 3, startDate: '2026-12-01', status: 'pending' });
  const done = record({ id: 4, period: 'completed', tripSlug: 'goa' });
  const lead = record({ id: 5, status: 'lead', tripSlug: 'meghalaya' });

  it('lists held seats on unfinished trips, soonest first', () => {
    expect(upcomingTrips([later, done, soon, lead]).map((r) => r.id)).toEqual([2, 3]);
  });
  it('finds an unfinished booking', () => {
    expect(unfinishedBooking([soon, lead])?.id).toBe(5);
    expect(unfinishedBooking([record({ status: 'lead', period: 'completed' })])).toBeNull();
  });
  it('finds a balance to pay', () => {
    expect(balanceDue([soon, record({ id: 9 }, { balanceActionable: true })])?.id).toBe(9);
    expect(balanceDue([soon])).toBeNull();
  });
});

describe('tripStates', () => {
  it('ranks going over went over saved', () => {
    const states = tripStates([
      record({ tripSlug: 'spiti', period: 'completed' }),
      record({ tripSlug: 'spiti', status: 'pending' }),
      record({ tripSlug: 'goa', period: 'completed' }),
      record({ tripSlug: 'ladakh', status: 'wishlist' }),
    ], ['goa', 'kerala']);
    expect(Object.fromEntries(states)).toEqual({ spiti: 'going', goa: 'went', ladakh: 'saved', kerala: 'saved' });
  });
  it('says nothing about cancelled or unfinished bookings', () => {
    expect(tripStates([record({ status: 'cancelled' }), record({ status: 'lead', tripSlug: 'goa' })]).size).toBe(0);
  });
});
