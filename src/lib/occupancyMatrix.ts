import { normalizeTierText } from './tripEditor';

// Per-departure, per-occupancy-tier male/female headroom.
//
// Rooms are single-gender: a Double holds 2 of one gender, a Triple 3. Ops needs
// to know, per tier, how many MORE male and how many MORE female can still be
// taken. `gender` and `tier_id` are on every registration row; this crosses them.
//
// IMPORTANT — this is a BEST-CASE estimate. There is no room-assignment data, so
// each gender's held travellers are assumed packed as tightly as possible into
// their own rooms. Real headroom can be lower if the current travellers are
// actually spread across more rooms; a room deliberately mixed makes this
// UNDERSTATE headroom (the safe side). `roomSizeForTier` is heuristic and falls
// back to 1 bed/room for an unrecognised tier name (also the safe side).
//
// The matrix counts LIVE DB registrations (confirmed + pending). The
// `{booked}/{cap} occupied` line on the page is the hand-maintained YAML seat
// counter — the two can differ, and that gap is itself useful signal.

export const HELD_STATUSES = ['confirmed', 'pending'] as const;

export type GenderBucket = 'male' | 'female' | 'other';

/**
 * male | m -> male ; female | f -> female ; everything else (explicit 'other',
 * blank, null, unknown import strings) -> other. An 'other' traveller can't be
 * auto-paired into a male or female room without a decision, so they get their
 * own bucket.
 */
export function genderBucket(raw: unknown): GenderBucket {
  const g = String(raw ?? '').trim().toLowerCase();
  if (g === 'male' || g === 'm') return 'male';
  if (g === 'female' || g === 'f') return 'female';
  return 'other';
}

/**
 * Beds per physical room for a tier, parsed from its id + label. First match wins:
 *   solo | single                                   -> 1
 *   double | twin | couple | "2 sharing"            -> 2
 *   triple | tripple | "3 sharing"                  -> 3
 *   quad | quadruple | "4 sharing"                  -> 4
 *   "<n> sharing/bed/pax/person/people/occupancy"   -> n
 *   private (not matched above)                     -> 1  (premium solo room)
 *   dorm | dormitory | hostel | bunk                -> null  (open block, not room-paired)
 *   (fallback)                                       -> 1
 * A numeric result is clamped to [1, cap] (cap null/0 -> no upper clamp).
 * `null` tells the caller to skip room-pairing for this tier (headroom = beds left).
 */
export function roomSizeForTier(tierId: string, label: string, cap: number | null): number | null {
  const t = `${normalizeTierText(tierId)} ${normalizeTierText(label)}`;
  const digit = (re: RegExp): number | null => {
    const m = t.match(re);
    return m ? Number(m[1]) : null;
  };
  const share = /(\d+)\s*(?:share|sharing|shared|bed|beds|bedded|pax|persons?|people|occupancy|sharing)/;

  let size: number | null;
  if (/\b(?:solo|single)\b/.test(t)) size = 1;
  else if (/\b(?:double|twin|couple)\b/.test(t) || /\b2\s*(?:share|sharing|bed|beds|pax|persons?|people|occupancy)\b/.test(t)) size = 2;
  else if (/\b(?:triple|tripple)\b/.test(t) || /\b3\s*(?:share|sharing|bed|beds|pax|persons?|people|occupancy)\b/.test(t)) size = 3;
  else if (/\b(?:quad|quadruple)\b/.test(t) || /\b4\s*(?:share|sharing|bed|beds|pax|persons?|people|occupancy)\b/.test(t)) size = 4;
  else if (digit(share) != null) size = digit(share);
  else if (/\bprivate\b/.test(t)) size = 1;
  else if (/\b(?:dorm|dormitory|hostel|bunk)\b/.test(t)) return null;
  else size = 1;

  if (size == null || !Number.isFinite(size) || size < 1) size = 1;
  if (cap != null && cap > 0) size = Math.min(size, cap);
  return size;
}

export interface TierOccupancyRow {
  tierId: string;
  label: string;
  cap: number | null; // total beds; null = unmetered
  roomSize: number | null; // null = open block (dorm) or unmetered
  totalRooms: number | null;
  held: { male: number; female: number; other: number; total: number };
  roomsUsed: { male: number; female: number; other: number; total: number } | null;
  roomsFree: number | null;
  headroom: { male: number | null; female: number | null; bedsLeft: number | null };
  overbooked: boolean;
}

export interface DepartureOccupancy {
  rows: TierOccupancyRow[];
  unmatchedHeld: number; // held rows whose tier_id / sharing_option matched no tier
  heldMale: number;
  heldFemale: number;
  heldOther: number;
}

interface RegLike {
  tier_id?: string | null;
  sharing_option?: string | null;
  gender?: string | null;
  status?: string | null;
}
interface TierLike {
  tierId: string;
  label: string;
  cap: number | null;
}

export function buildDepartureOccupancy(regs: RegLike[], tierOptions: TierLike[]): DepartureOccupancy {
  const validTierIds = new Set(tierOptions.map((t) => t.tierId));
  const labelToTierId = new Map(tierOptions.map((t) => [t.label, t.tierId]));

  const byTier = new Map<string, { male: number; female: number; other: number }>();
  const bump = (key: string, bucket: GenderBucket) => {
    let e = byTier.get(key);
    if (!e) {
      e = { male: 0, female: 0, other: 0 };
      byTier.set(key, e);
    }
    e[bucket] += 1;
  };

  let unmatchedHeld = 0;
  let heldMale = 0;
  let heldFemale = 0;
  let heldOther = 0;

  for (const r of regs) {
    if (!(HELD_STATUSES as readonly string[]).includes(String(r.status))) continue;
    const bucket = genderBucket(r.gender);
    if (bucket === 'male') heldMale += 1;
    else if (bucket === 'female') heldFemale += 1;
    else heldOther += 1;

    let key = r.tier_id ? String(r.tier_id) : '';
    if (!key || !validTierIds.has(key)) {
      const viaLabel = r.sharing_option ? labelToTierId.get(String(r.sharing_option)) : undefined;
      key = viaLabel ?? '';
    }
    if (key && validTierIds.has(key)) bump(key, bucket);
    else unmatchedHeld += 1;
  }

  const rows = tierOptions.map<TierOccupancyRow>((t) => {
    const held = byTier.get(t.tierId) ?? { male: 0, female: 0, other: 0 };
    const heldTotal = held.male + held.female + held.other;
    const cap = t.cap;

    const row: TierOccupancyRow = {
      tierId: t.tierId,
      label: t.label,
      cap,
      roomSize: cap == null ? null : roomSizeForTier(t.tierId, t.label, cap),
      totalRooms: null,
      held: { ...held, total: heldTotal },
      roomsUsed: null,
      roomsFree: null,
      headroom: { male: null, female: null, bedsLeft: null },
      overbooked: false,
    };

    if (cap === 0) {
      row.totalRooms = 0;
      row.roomsUsed = { male: 0, female: 0, other: 0, total: 0 };
      row.roomsFree = 0;
      row.headroom = { male: 0, female: 0, bedsLeft: 0 };
      row.overbooked = heldTotal > 0;
      return row;
    }

    if (cap == null || row.roomSize == null) {
      const bedsLeft = cap == null ? null : Math.max(0, cap - heldTotal);
      row.headroom = { male: bedsLeft, female: bedsLeft, bedsLeft };
      row.overbooked = cap != null && heldTotal > cap;
      return row;
    }

    const roomSize = row.roomSize;
    const totalRooms = Math.ceil(cap / roomSize);
    const roomsUsed = {
      male: Math.ceil(held.male / roomSize),
      female: Math.ceil(held.female / roomSize),
      other: Math.ceil(held.other / roomSize),
      total: 0,
    };
    roomsUsed.total = roomsUsed.male + roomsUsed.female + roomsUsed.other;
    const roomsFree = Math.max(0, totalRooms - roomsUsed.total);
    const bedsLeft = Math.max(0, cap - heldTotal);
    const overbooked = heldTotal > cap || roomsUsed.total > totalRooms;

    const headroomFor = (usedRooms: number, heldGender: number) =>
      Math.min(usedRooms * roomSize - heldGender + roomsFree * roomSize, bedsLeft);

    row.totalRooms = totalRooms;
    row.roomsUsed = roomsUsed;
    row.roomsFree = roomsFree;
    row.headroom = {
      male: overbooked ? null : headroomFor(roomsUsed.male, held.male),
      female: overbooked ? null : headroomFor(roomsUsed.female, held.female),
      bedsLeft,
    };
    row.overbooked = overbooked;
    return row;
  });

  return { rows, unmatchedHeld, heldMale, heldFemale, heldOther };
}
