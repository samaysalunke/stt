import { describe, expect, it } from 'vitest';
import {
  roomSizeForTier,
  genderBucket,
  buildDepartureOccupancy,
} from '../../src/lib/occupancyMatrix';

const reg = (tier_id: string, gender: string, status = 'confirmed', sharing_option = '') => ({
  tier_id, gender, status, sharing_option,
});
const tier = (tierId: string, cap: number | null, label = tierId) => ({ tierId, label, cap });

describe('genderBucket', () => {
  it.each([
    ['male', 'male'], ['Male', 'male'], ['M', 'male'],
    ['female', 'female'], ['F', 'female'],
    ['other', 'other'], ['', 'other'], [null, 'other'], ['nonbinary', 'other'],
  ])('%s -> %s', (input, expected) => {
    expect(genderBucket(input)).toBe(expected);
  });
});

describe('roomSizeForTier', () => {
  it.each<[string, string, number | null]>([
    ['solo', 'Solo Room', 1],
    ['single', 'Single', 1],
    ['double', 'Double Sharing', 2],
    ['twin', 'Twin', 2],
    ['triple', 'Triple Sharing', 3],
    ['tripple', 'Tripple', 3],
    ['quad', 'Quad', 4],
    ['s4', '4 Sharing', 4],
    ['s5', '5 sharing', 5],
    ['standard', 'Standard', 1],
    ['triple', 'Triple (Rs 29,000)', 3],
    ['private', 'Private Room', 1],
    ['private', 'Private Double', 2],
    ['dorm', 'Dorm Bed', null],
    ['dormitory', 'Dormitory', null],
  ])('%s / %s -> %s', (id, label, expected) => {
    expect(roomSizeForTier(id, label, 12)).toBe(expected);
  });

  it('clamps the room size to the tier cap', () => {
    expect(roomSizeForTier('quad', 'Quad', 2)).toBe(2);
  });
});

describe('buildDepartureOccupancy', () => {
  it("computes single-gender headroom for the user's scenario", () => {
    const regs = [
      ...Array(3).fill(0).map(() => reg('triple', 'male', 'confirmed')),
      ...Array(2).fill(0).map(() => reg('triple', 'male', 'pending')),
      ...Array(2).fill(0).map(() => reg('triple', 'female', 'confirmed')),
      reg('triple', 'male', 'lead'), // ignored — not held
    ];
    const { rows } = buildDepartureOccupancy(regs, [tier('triple', 12, 'Triple')]);
    const r = rows[0];
    expect(r.roomSize).toBe(3);
    expect(r.totalRooms).toBe(4);
    expect(r.held).toEqual({ male: 5, female: 2, other: 0, total: 7 });
    expect(r.roomsUsed).toEqual({ male: 2, female: 1, other: 0, total: 3 });
    expect(r.roomsFree).toBe(1);
    expect(r.headroom).toEqual({ male: 4, female: 4, bedsLeft: 5 });
    expect(r.overbooked).toBe(false);
  });

  it('keeps two tiers on one departure independent', () => {
    const regs = [
      reg('triple', 'male'), reg('triple', 'male'),
      reg('double', 'female'),
    ];
    const { rows } = buildDepartureOccupancy(regs, [tier('triple', 12, 'Triple'), tier('double', 4, 'Double')]);
    const triple = rows.find((x) => x.tierId === 'triple')!;
    const double = rows.find((x) => x.tierId === 'double')!;
    expect(triple.held.male).toBe(2);
    expect(triple.held.female).toBe(0);
    expect(double.roomSize).toBe(2);
    expect(double.held.female).toBe(1);
    expect(double.held.male).toBe(0);
  });

  it('flags an overbooked-by-count tier and nulls its headroom', () => {
    const regs = [reg('double', 'male'), reg('double', 'male'), reg('double', 'male')];
    const { rows } = buildDepartureOccupancy(regs, [tier('double', 2, 'Double')]);
    const r = rows[0];
    expect(r.overbooked).toBe(true);
    expect(r.headroom.bedsLeft).toBe(0);
    expect(r.headroom.male).toBeNull();
    expect(r.headroom.female).toBeNull();
  });

  it('flags an overbooked-by-fragmentation tier (needs more rooms than exist)', () => {
    const regs = [reg('triple', 'male'), reg('triple', 'female')];
    const { rows } = buildDepartureOccupancy(regs, [tier('triple', 3, 'Triple')]);
    const r = rows[0];
    expect(r.totalRooms).toBe(1);
    expect(r.roomsUsed!.total).toBe(2);
    expect(r.overbooked).toBe(true);
    expect(r.headroom.male).toBeNull();
    expect(r.headroom.female).toBeNull();
  });

  it('treats a dorm as an open block — headroom equals beds left for each gender', () => {
    const regs = [reg('dorm', 'male'), reg('dorm', 'male'), reg('dorm', 'male'), reg('dorm', 'female'), reg('dorm', 'female')];
    const { rows } = buildDepartureOccupancy(regs, [tier('dorm', 10, 'Dorm Bed')]);
    const r = rows[0];
    expect(r.roomSize).toBeNull();
    expect(r.roomsUsed).toBeNull();
    expect(r.headroom).toEqual({ male: 5, female: 5, bedsLeft: 5 });
    expect(r.overbooked).toBe(false);
  });

  it('flags a dorm overbooked past its bed count', () => {
    const regs = Array(12).fill(0).map(() => reg('dorm', 'male'));
    const { rows } = buildDepartureOccupancy(regs, [tier('dorm', 10, 'Dorm Bed')]);
    expect(rows[0].overbooked).toBe(true);
    expect(rows[0].headroom.bedsLeft).toBe(0);
  });

  it('handles an unmetered tier (cap null)', () => {
    const regs = [reg('open', 'male'), reg('open', 'female')];
    const { rows } = buildDepartureOccupancy(regs, [tier('open', null, 'Open')]);
    const r = rows[0];
    expect(r.totalRooms).toBeNull();
    expect(r.roomsUsed).toBeNull();
    expect(r.roomsFree).toBeNull();
    expect(r.headroom).toEqual({ male: null, female: null, bedsLeft: null });
    expect(r.held.total).toBe(2);
  });

  it('handles a closed tier (cap 0)', () => {
    const empty = buildDepartureOccupancy([], [tier('solo', 0, 'Solo')]).rows[0];
    expect(empty.totalRooms).toBe(0);
    expect(empty.headroom).toEqual({ male: 0, female: 0, bedsLeft: 0 });
    expect(empty.overbooked).toBe(false);

    const withHeld = buildDepartureOccupancy([reg('solo', 'male')], [tier('solo', 0, 'Solo')]).rows[0];
    expect(withHeld.overbooked).toBe(true);
  });

  it('matches legacy rows by sharing_option label and reports unmatched holds', () => {
    const regs = [
      { tier_id: '', sharing_option: 'Triple', gender: 'male', status: 'confirmed' },
      { tier_id: '', sharing_option: 'Nonexistent', gender: 'female', status: 'confirmed' },
    ];
    const out = buildDepartureOccupancy(regs, [tier('triple', 12, 'Triple')]);
    expect(out.rows[0].held.male).toBe(1);
    expect(out.unmatchedHeld).toBe(1);
    expect(out.heldFemale).toBe(1); // still counted in the departure totals
  });

  it('buckets an "other" traveller into their own room, not a male/female one', () => {
    // Triple cap 6 = 2 rooms. 2 male + 1 other held.
    const regs = [reg('triple', 'male'), reg('triple', 'male'), reg('triple', 'other')];
    const { rows } = buildDepartureOccupancy(regs, [tier('triple', 6, 'Triple')]);
    const r = rows[0];
    expect(r.held.other).toBe(1);
    expect(r.roomsUsed).toEqual({ male: 1, female: 0, other: 1, total: 2 });
    expect(r.roomsFree).toBe(0);
    // one male seat free in the male room; no free room for a new female
    expect(r.headroom.male).toBe(1);
    expect(r.headroom.female).toBe(0);
    expect(r.headroom.bedsLeft).toBe(3);
  });

  it('sums held male/female/other across every tier of the departure', () => {
    const regs = [
      reg('triple', 'male'), reg('triple', 'female'),
      reg('double', 'male'), reg('double', 'other'),
    ];
    const out = buildDepartureOccupancy(regs, [tier('triple', 12, 'Triple'), tier('double', 4, 'Double')]);
    expect(out.heldMale).toBe(2);
    expect(out.heldFemale).toBe(1);
    expect(out.heldOther).toBe(1);
  });
});
