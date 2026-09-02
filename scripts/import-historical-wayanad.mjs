#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import Database from 'better-sqlite3';
import { readHistoricalCsv } from './lib/historical-registration-import.mjs';
import {
  WAYANAD_HISTORICAL_CONFIG,
  analyzeWayanadCsv,
  importWayanadCsv,
} from './lib/wayanad-historical-import.mjs';

const apply = process.argv.includes('--apply');
const csvArg = process.argv.find((arg, index) => index > 1 && !arg.startsWith('--'));
if (!csvArg) {
  console.error('Usage: node scripts/import-historical-wayanad.mjs <csv> [--apply]');
  process.exit(1);
}
const dataDir = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
const db = new Database(path.join(dataDir, 'seekthethrill.db'));
db.pragma('foreign_keys = ON');
try {
  const csv = readHistoricalCsv(csvArg);
  const result = apply ? importWayanadCsv(csv, db) : analyzeWayanadCsv(csv, db);
  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    tripSlug: WAYANAD_HISTORICAL_CONFIG.tripSlug,
    batchId: WAYANAD_HISTORICAL_CONFIG.batchId,
    counts: result.counts,
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
