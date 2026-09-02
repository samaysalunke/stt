import fs from 'node:fs';

export const NAGALAND_HISTORICAL_CONFIG = Object.freeze({
  tripName: 'Nagaland — Hornbill Festival Special, December 2025',
  tripSlug: 'nagaland-hornbill-festival-december-2025',
  tripDate: '5 Dec 2025 – 11 Dec 2025',
  batchId: 'nagaland-hornbill-festival-2025-12-05',
  tierId: 'standard',
  totalAmount: 20500,
  heldRows: [5, 37, 50, 55, 56, 57],
});

const EXPECTED_HEADERS = [
  'timestamp',
  'what do we call you?',
  'train status',
  'reached guwahati',
  'flight issue',
  'column 13',
  'email id',
  'whatsapp no.',
  'emergency contact',
  'gender',
  'how old are you?',
  'which city are you based out of currently?',
  "what's your instagram handle?",
  'why are you joining this trip?',
];

const clean = (value) => String(value ?? '').normalize('NFKC').trim();
const headerKey = (value) => clean(value)
  .replace(/[\u2018\u2019]/g, "'")
  .replace(/\s+/g, ' ')
  .toLowerCase();

export const normalizeEmail = (value) => clean(value).toLowerCase();

export function parseCsv(input) {
  const text = String(input).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += char;
  }
  row.push(field);
  rows.push(row);
  if (rows.at(-1)?.length === 1 && rows.at(-1)[0] === '') rows.pop();
  return rows;
}

export function parseIndiaTimestamp(value) {
  const match = clean(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, month, day, year, hour, minute, second] = match.map(Number);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return null;
  const utc = Date.UTC(year, month - 1, day, hour - 5, minute - 30, second);
  const localCheck = new Date(utc + 330 * 60_000);
  if (localCheck.getUTCFullYear() !== year || localCheck.getUTCMonth() !== month - 1 || localCheck.getUTCDate() !== day ||
      localCheck.getUTCHours() !== hour || localCheck.getUTCMinutes() !== minute || localCheck.getUTCSeconds() !== second) return null;
  return new Date(utc).toISOString().slice(0, 19).replace('T', ' ');
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function analyzeHistoricalCsv(csv, db, config = NAGALAND_HISTORICAL_CONFIG) {
  const rows = parseCsv(csv);
  if (rows.length < 2) throw new Error('CSV contains no response rows');
  const headers = rows[0].map(headerKey);
  for (let i = 0; i < EXPECTED_HEADERS.length; i++) {
    if (headers[i] !== EXPECTED_HEADERS[i]) throw new Error(`Unexpected header in column ${i + 1}`);
  }
  if (!headers[14]?.startsWith('by signing up for this trip, i acknowledge')) {
    throw new Error('Unexpected consent header in column 15');
  }

  const held = new Set(config.heldRows);
  const candidates = [];
  const rejected = [];
  const heldRows = [];
  for (let index = 1; index < rows.length; index++) {
    const sheetRow = index + 1;
    const cells = rows[index];
    if (cells.every((cell) => !clean(cell))) continue;
    if (held.has(sheetRow)) { heldRows.push(sheetRow); continue; }

    const statusRaw = clean(cells[5]).toLowerCase();
    const status = statusRaw === 'fully paid' ? 'confirmed' : statusRaw === '' ? 'lead' : null;
    const createdAt = parseIndiaTimestamp(cells[0]);
    const email = normalizeEmail(cells[6]);
    const reasons = [];
    if (!clean(cells[1])) reasons.push('missing name');
    if (!validEmail(email)) reasons.push('invalid email');
    if (!clean(cells[7])) reasons.push('missing phone');
    if (!createdAt) reasons.push('invalid timestamp');
    if (!status) reasons.push(`unknown payment status: ${clean(cells[5])}`);
    if (!clean(cells[14])) reasons.push('missing consent');
    if (reasons.length) { rejected.push({ row: sheetRow, reasons }); continue; }

    candidates.push({
      row: sheetRow,
      fullName: clean(cells[1]), email, phone: clean(cells[7]),
      emergencyPhone: clean(cells[8]), gender: clean(cells[9]), age: clean(cells[10]),
      city: clean(cells[11]), instagram: clean(cells[12]), whyJoin: clean(cells[13]),
      status, paymentStatus: status === 'confirmed' ? 'fully_paid' : 'unpaid',
      amountPaid: status === 'confirmed' ? config.totalAmount : 0,
      createdAt, consentAt: createdAt,
    });
  }

  return analyzePreparedHistoricalRows({ candidates, rejected, heldRows }, db, config);
}

export function analyzePreparedHistoricalRows({ candidates, rejected = [], heldRows = [] }, db, config) {
  const frequencies = new Map();
  for (const row of candidates) frequencies.set(row.email, (frequencies.get(row.email) ?? 0) + 1);
  const duplicateEmails = [...frequencies.entries()].filter(([, count]) => count > 1).map(([email]) => email);

  const hasExistingCustomer = db.prepare(
    'SELECT 1 FROM registrations WHERE lower(trim(email))=? LIMIT 1',
  );
  const hasSameDeparture = db.prepare(
    'SELECT 1 FROM registrations WHERE lower(trim(email))=? AND trip_slug=? AND batch_id=? LIMIT 1',
  );
  let existingCustomerMatches = 0;
  const create = [];
  const skipped = [];
  for (const row of candidates) {
    if (hasSameDeparture.get(row.email, config.tripSlug, config.batchId)) {
      skipped.push({ row: row.row, reason: 'same-departure duplicate' });
      continue;
    }
    if (hasExistingCustomer.get(row.email)) existingCustomerMatches++;
    create.push(row);
  }

  return {
    candidates,
    create,
    skipped,
    rejected,
    heldRows,
    duplicateEmails,
    existingCustomerMatches,
    counts: {
      confirmed: candidates.filter((row) => row.status === 'confirmed').length,
      leads: candidates.filter((row) => row.status === 'lead').length,
      held: heldRows.length,
      rejected: rejected.length,
      duplicateEmails: duplicateEmails.length,
      existingCustomerMatches,
      toCreate: create.length,
      skipped: skipped.length,
    },
  };
}

function countSideEffects(db) {
  const count = (table) => db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
  return {
    users: count('users'),
    payments: count('payment_events'),
    documents: count('invoice_documents'),
    telegram: count('telegram_notification_events'),
    emails: count('email_delivery_log'),
  };
}

export function importPreparedHistoricalRows(analysis, db, config) {
  if (analysis.rejected.length || analysis.duplicateEmails.length) {
    throw new Error('Import refused: CSV has rejected rows or duplicate emails');
  }
  const before = countSideEffects(db);
  const insert = db.prepare(`
    INSERT INTO registrations (
      trip_name, trip_slug, trip_date, full_name, email, phone,
      emergency_name, emergency_phone, gender, age, city, instagram, why_join,
      batch_id, tier_id, sharing_option, total_amount, amount_paid, amount_refunded,
      payment_status, payment_date, payment_method, transaction_id,
      status, status_changed_at, source, source_detail, photo_consent,
      consent_at, created_at, updated_at, admin_notes, email_sent
    ) VALUES (
      @tripName, @tripSlug, @tripDate, @fullName, @email, @phone,
      '', @emergencyPhone, @gender, @age, @city, @instagram, @whyJoin,
      @batchId, @tierId, @sharingOption, @totalAmount, @amountPaid, 0,
      @paymentStatus, NULL, NULL, NULL,
      @status, @createdAt, 'historical-google-forms', NULL, 0,
      @consentAt, @createdAt, @createdAt, 'Historical Google Forms import', 0
    )
  `);
  const apply = db.transaction(() => {
    for (const row of analysis.create) insert.run({ sharingOption: null, ...config, ...row });
  });
  apply();
  const after = countSideEffects(db);
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error('Outbound side-effect state changed unexpectedly');
  }
  return { ...analysis, inserted: analysis.create.length, sideEffectsBefore: before, sideEffectsAfter: after };
}

export function importHistoricalCsv(csv, db, config = NAGALAND_HISTORICAL_CONFIG) {
  return importPreparedHistoricalRows(analyzeHistoricalCsv(csv, db, config), db, config);
}

export function readHistoricalCsv(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}
