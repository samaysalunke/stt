/**
 * Minimal RFC-4180-ish CSV parser — no external dependency.
 *
 * Handles: quoted fields, escaped quotes ("") inside quotes, commas and
 * newlines inside quoted fields, and \r\n / \r / \n line endings.
 */
export function parseCsv(input: string): string[][] {
  const s = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < s.length) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; } // escaped quote
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  row.push(field);
  rows.push(row);

  // Drop a single trailing empty row produced by a final newline.
  if (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') {
    rows.pop();
  }
  return rows;
}

/**
 * Parse CSV into objects keyed by the header row (headers lowercased + trimmed).
 * Fully-blank lines are skipped.
 */
export function parseCsvToObjects(input: string): Record<string, string>[] {
  const rows = parseCsv(input);
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const out: Record<string, string>[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    if (cells.every((c) => c.trim() === '')) continue;
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => { obj[h] = (cells[idx] ?? '').trim(); });
    out.push(obj);
  }
  return out;
}

const normalizeKey = (value: string) => normalizeHeader(value);

const TIER_HEADER_HINTS = [
  'tier_id',
  'tier',
  'occupancy',
  'occupancy option',
  'stay',
  'stay option',
  'sharing',
  'sharing option',
  'sharing tier',
];

export function inferTierIdFromRow(row: Record<string, string>): string {
  for (const [key, value] of Object.entries(row)) {
    const normalizedKey = normalizeKey(key);
    if (!TIER_HEADER_HINTS.some((hint) => normalizedKey === normalizeKey(hint) || normalizedKey.includes(normalizeKey(hint)))) continue;
    const tier = value.trim();
    if (tier) return tier;
  }
  return '';
}

export const GOOGLE_FORM_ACCEPTANCE = 'I agree to the terms and conditions';

const normalizeHeader = (value: string) => value
  .normalize('NFKC')
  .replace(/[\u2018\u2019]/g, "'")
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

const GOOGLE_HEADERS = {
  timestamp: 'timestamp',
  name: 'what do we call you?',
  email: 'email id',
  phone: 'whatsapp no.',
  emergencyPhone: 'emergency contact',
  gender: 'gender',
  age: 'how old are you?',
  city: 'which city are you based out of currently?',
  instagram: "what's your instagram handle?",
  reason: 'why are you joining this trip?',
  stay: 'what stay option do you prefer?',
  status: 'status',
} as const;

export interface GoogleRegistrationRow {
  row: number;
  full_name: string;
  email: string;
  phone: string;
  emergency_phone: string;
  gender: string;
  age: string;
  city: string;
  instagram: string;
  why_join: string;
  tier_id: string;
  stay_raw: string;
  status: 'lead' | 'confirmed' | '';
  created_at: string | null;
  consent_at: string | null;
  error?: string;
  superseded?: boolean;
  supersededByRow?: number;
}

/** Strictly parse a Forms timestamp as Asia/Kolkata and return SQLite UTC time. */
export function parseIndiaFormsTimestamp(value: string): string | null {
  const m = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, month, day, year, hour, minute, second] = m.map(Number);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return null;
  // IST has no daylight-saving transitions and is always UTC+05:30.
  const utc = Date.UTC(year, month - 1, day, hour - 5, minute - 30, second);
  const d = new Date(utc);
  const check = new Date(utc + 330 * 60_000);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day ||
      check.getUTCHours() !== hour || check.getUTCMinutes() !== minute || check.getUTCSeconds() !== second) return null;
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

/** Returns null when the CSV is not the supported Google Forms export. */
export function parseGoogleFormsRegistrations(input: string): GoogleRegistrationRow[] | null {
  const rows = parseCsv(input);
  if (!rows.length) return null;
  const headers = rows[0].map(normalizeHeader);
  const index = (expected: string) => headers.indexOf(normalizeHeader(expected));
  const required = Object.fromEntries(Object.entries(GOOGLE_HEADERS).map(([key, value]) => [key, index(value)])) as Record<keyof typeof GOOGLE_HEADERS, number>;
  // "Accommodation preference" is an alias used by some forms; stay column is optional for single-tier trips.
  if (required.stay < 0) required.stay = index('accommodation preference');
  const { stay: _stayIdx, ...requiredCore } = required;
  if (Object.values(requiredCore).some((i) => i < 0)) return null;
  const consentIndex = headers.findIndex((h) => h.startsWith('by signing up for this trip, i acknowledge'));
  if (consentIndex < 0) return null;

  const result: GoogleRegistrationRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    if (cells.every((c) => !c.trim())) continue;
    const get = (key: keyof typeof GOOGLE_HEADERS) => (cells[required[key]] ?? '').trim();
    const timestamp = parseIndiaFormsTimestamp(get('timestamp'));
    const stay = required.stay >= 0 ? get('stay') : '';
    const sourceStatus = get('status');
    const stayLower = stay.toLowerCase();
    const tier_id = stayLower === 'double sharing' ? 'double' : stayLower === 'triple sharing' ? 'triple' : stayLower === 'dorm' ? 'dorm' : '';
    const status = sourceStatus === 'Confirmed' ? 'confirmed' : sourceStatus === '' ? 'lead' : '';
    const errors: string[] = [];
    if (!timestamp) errors.push('Invalid timestamp');
    // Stay → tier validity is decided trip-aware in the importer (against the
    // trip's occupancyCatalog), not here — the pure parser has no trip context.
    if (!status) errors.push(`Unknown status: ${sourceStatus}`);
    result.push({
      row: i,
      full_name: get('name'), email: get('email').toLowerCase(), phone: get('phone'),
      emergency_phone: get('emergencyPhone'), gender: get('gender'), age: get('age'),
      city: get('city'), instagram: get('instagram'), why_join: get('reason'),
      tier_id, stay_raw: stay, status, created_at: timestamp,
      consent_at: timestamp && (cells[consentIndex] ?? '').trim() === GOOGLE_FORM_ACCEPTANCE ? timestamp : null,
      error: errors.length ? errors.join('; ') : undefined,
    });
  }

  // Latest valid timestamp wins. Invalid-timestamp rows cannot supersede valid data.
  const winner = new Map<string, GoogleRegistrationRow>();
  for (const row of result) {
    if (!row.email || !row.created_at) continue;
    const current = winner.get(row.email);
    if (!current || row.created_at > current.created_at!) winner.set(row.email, row);
  }
  for (const row of result) {
    const latest = row.email ? winner.get(row.email) : undefined;
    if (latest && latest !== row) {
      row.superseded = true;
      row.supersededByRow = latest.row;
    }
  }
  return result;
}
