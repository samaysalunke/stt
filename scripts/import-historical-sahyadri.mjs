#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import Database from 'better-sqlite3';
import { readHistoricalCsv } from './lib/historical-registration-import.mjs';
import {
  analyzeSahyadriCsv,
  importSahyadriCsv,
  sahyadriConfig,
} from './lib/sahyadri-historical-import.mjs';

const apply = process.argv.includes('--apply');
const csvArg = process.argv.find((arg, index) => index > 1 && !arg.startsWith('--'));
const departureArg = process.argv.find((arg) => arg.startsWith('--departure='));
const departure = departureArg?.slice('--departure='.length);
if (!csvArg || !departure) {
  console.error('Usage: node scripts/import-historical-sahyadri.mjs <csv> --departure=YYYY-MM-DD [--apply]');
  process.exit(1);
}

const config = sahyadriConfig(departure);
const dataDir = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
const db = new Database(path.join(dataDir, 'seekthethrill.db'));
db.pragma('foreign_keys = ON');
try {
  const csv = readHistoricalCsv(csvArg);
  const result = apply
    ? importSahyadriCsv(csv, db, departure)
    : analyzeSahyadriCsv(csv, db, departure);
  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    tripSlug: config.tripSlug,
    batchId: config.batchId,
    totalAmount: config.totalAmount,
    counts: result.counts,
    missingConsent: result.candidates.filter((row) => row.missingConsent).length,
    inserted: result.inserted ?? 0,
    rejected: result.rejected,
    skipped: result.skipped,
    duplicateEmails: result.duplicateEmails,
    existingCustomerMatches: result.existingCustomerMatches,
    sideEffectsUnchanged: apply
      ? JSON.stringify(result.sideEffectsBefore) === JSON.stringify(result.sideEffectsAfter)
      : undefined,
  }, null, 2));
  if (result.rejected.length || result.duplicateEmails.length) process.exitCode = 1;
} finally {
  db.close();
}
