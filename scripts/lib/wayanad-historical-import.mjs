import {
  analyzePreparedHistoricalRows,
  importPreparedHistoricalRows,
  normalizeEmail,
  parseCsv,
  parseIndiaTimestamp,
} from './historical-registration-import.mjs';

export const WAYANAD_HISTORICAL_CONFIG = Object.freeze({
  tripName: 'Offbeat Wayanad Getaway, September 2025',
  tripSlug: 'offbeat-wayanad-getaway-september-2025',
  tripDate: '26 Sep 2025 – 28 Sep 2025',
  batchId: 'offbeat-wayanad-getaway-2025-09-26',
  tierId: 'standard',
  totalAmount: 12000,
});

const EXPECTED_HEADERS = [
  'timestamp', 'what do we call you?', 'email id', 'whatsapp no.',
  'emergency contact', 'gender', 'how old are you?',
  'which city are you based out of currently?', "what's your instagram handle?",
  'why are you joining this trip?',
];

const clean = (value) => String(value ?? '').normalize('NFKC').trim();
const headerKey = (value) => clean(value)
  .replace(/[‘’]/g, "'")
  .replace(/\s+/g, ' ')
  .toLowerCase();
const validEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

export function analyzeWayanadCsv(csv, db, config = WAYANAD_HISTORICAL_CONFIG) {
  const rows = parseCsv(csv);
  if (rows.length < 2) throw new Error('CSV contains no response rows');
  const headers = rows[0].map(headerKey);
  for (let index = 0; index < EXPECTED_HEADERS.length; index++) {
    if (headers[index] !== EXPECTED_HEADERS[index]) throw new Error(`Unexpected header in column ${index + 1}`);
  }
  if (!headers[10]?.startsWith('by signing up for this trip, i acknowledge')) {
    throw new Error('Unexpected consent header in column 11');
  }
  if (headers[11] !== 'status') {
    throw new Error('Unexpected status header in column 12');
  }

  const candidates = [];
  const rejected = [];
  for (let index = 1; index < rows.length; index++) {
    const cells = rows[index];
    if (cells.every((cell) => !clean(cell))) continue;
    const sheetRow = index + 1;
    const email = normalizeEmail(cells[2]);
    const createdAt = parseIndiaTimestamp(cells[0]);
    const sourceStatus = clean(cells[11]).toLowerCase();
    const status = sourceStatus === 'confirmed' ? 'confirmed' : sourceStatus === '' ? 'lead' : null;
    const reasons = [];
    if (!clean(cells[1])) reasons.push('missing name');
    if (!validEmail(email)) reasons.push('invalid email');
    if (!clean(cells[3])) reasons.push('missing phone');
    if (!createdAt) reasons.push('invalid timestamp');
    if (!clean(cells[10])) reasons.push('missing consent');
    if (!status) reasons.push(`unknown status: ${clean(cells[11])}`);
    if (reasons.length) { rejected.push({ row: sheetRow, reasons }); continue; }

    candidates.push({
      row: sheetRow,
      fullName: clean(cells[1]), email, phone: clean(cells[3]),
      emergencyPhone: clean(cells[4]), gender: clean(cells[5]), age: clean(cells[6]),
      city: clean(cells[7]), instagram: clean(cells[8]), whyJoin: clean(cells[9]),
      tierId: config.tierId,
      sharingOption: null,
      totalAmount: config.totalAmount,
      status,
      paymentStatus: status === 'confirmed' ? 'fully_paid' : 'unpaid',
      amountPaid: status === 'confirmed' ? config.totalAmount : 0,
      createdAt,
      consentAt: createdAt,
    });
  }
  return analyzePreparedHistoricalRows({ candidates, rejected }, db, config);
}

export function importWayanadCsv(csv, db, config = WAYANAD_HISTORICAL_CONFIG) {
  return importPreparedHistoricalRows(analyzeWayanadCsv(csv, db, config), db, config);
}
