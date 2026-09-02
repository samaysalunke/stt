import {
  analyzePreparedHistoricalRows,
  importPreparedHistoricalRows,
  normalizeEmail,
  parseCsv,
  parseIndiaTimestamp,
} from './historical-registration-import.mjs';

export const SOUTH_GOA_HISTORICAL_CONFIG = Object.freeze({
  tripName: 'South Goa — Riverside & Beach Escape, October 2025',
  tripSlug: 'south-goa-riverside-beach-october-2025',
  tripDate: '2 Oct 2025 – 5 Oct 2025',
  batchId: 'south-goa-2025-10-02',
});

const EXPECTED_HEADERS = [
  'timestamp', 'what do we call you?', 'email id', 'whatsapp no.',
  'emergency contact', 'gender', 'how old are you?',
  'which city are you based out of currently?', "what's your instagram handle?",
  'why are you joining this trip?',
];

const clean = (value) => String(value ?? '').normalize('NFKC').trim();
const headerKey = (value) => clean(value)
  .replace(/[\u2018\u2019]/g, "'")
  .replace(/\s+/g, ' ')
  .toLowerCase();
const validEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

function packageFor(value) {
  const transport = clean(value).toLowerCase();
  if (!transport || transport === 'joining from bangalore') {
    return { tierId: 'bangalore-package', sharingOption: 'From Bangalore', totalAmount: 15999, transportDefaulted: !transport };
  }
  if (transport === 'joining at goa directly') {
    return { tierId: 'goa-direct', sharingOption: 'Meet in Goa', totalAmount: 12999, transportDefaulted: false };
  }
  return null;
}

export function analyzeSouthGoaCsv(csv, db, config = SOUTH_GOA_HISTORICAL_CONFIG) {
  const rows = parseCsv(csv);
  if (rows.length < 2) throw new Error('CSV contains no response rows');
  const headers = rows[0].map(headerKey);
  for (let index = 0; index < EXPECTED_HEADERS.length; index++) {
    if (headers[index] !== EXPECTED_HEADERS[index]) throw new Error(`Unexpected header in column ${index + 1}`);
  }
  if (!headers[10]?.startsWith('by signing up for this trip, i acknowledge')) {
    throw new Error('Unexpected consent header in column 11');
  }
  if (headers[11] !== 'what is your transport situation?' || headers[12] !== 'status') {
    throw new Error('Unexpected transport or status header');
  }

  const candidates = [];
  const rejected = [];
  for (let index = 1; index < rows.length; index++) {
    const cells = rows[index];
    if (cells.every((cell) => !clean(cell))) continue;
    const sheetRow = index + 1;
    const email = normalizeEmail(cells[2]);
    const createdAt = parseIndiaTimestamp(cells[0]);
    const sourceStatus = clean(cells[12]).toLowerCase();
    const status = sourceStatus === 'confirmed' ? 'confirmed' : sourceStatus === '' ? 'lead' : null;
    const selectedPackage = packageFor(cells[11]);
    const reasons = [];
    if (!clean(cells[1])) reasons.push('missing name');
    if (!validEmail(email)) reasons.push('invalid email');
    if (!clean(cells[3])) reasons.push('missing phone');
    if (!createdAt) reasons.push('invalid timestamp');
    if (!clean(cells[10])) reasons.push('missing consent');
    if (!status) reasons.push(`unknown status: ${clean(cells[12])}`);
    if (!selectedPackage) reasons.push(`unknown transport selection: ${clean(cells[11])}`);
    if (reasons.length) { rejected.push({ row: sheetRow, reasons }); continue; }

    const amountPaid = status === 'confirmed' ? selectedPackage.totalAmount : 0;
    candidates.push({
      row: sheetRow,
      fullName: clean(cells[1]), email, phone: clean(cells[3]),
      emergencyPhone: clean(cells[4]), gender: clean(cells[5]), age: clean(cells[6]),
      city: clean(cells[7]), instagram: clean(cells[8]), whyJoin: clean(cells[9]),
      ...selectedPackage,
      status,
      paymentStatus: status === 'confirmed' ? 'fully_paid' : 'unpaid',
      amountPaid,
      createdAt,
      consentAt: createdAt,
    });
  }
  return analyzePreparedHistoricalRows({ candidates, rejected }, db, config);
}

export function importSouthGoaCsv(csv, db, config = SOUTH_GOA_HISTORICAL_CONFIG) {
  return importPreparedHistoricalRows(analyzeSouthGoaCsv(csv, db, config), db, config);
}
