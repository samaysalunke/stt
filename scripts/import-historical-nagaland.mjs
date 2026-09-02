#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import Database from 'better-sqlite3';
import {
  NAGALAND_HISTORICAL_CONFIG,
  analyzeHistoricalCsv,
  importHistoricalCsv,
  readHistoricalCsv,
} from './lib/historical-registration-import.mjs';

const apply = process.argv.includes('--apply');
const csvArg = process.argv.find((arg, index) => index > 1 && !arg.startsWith('--'));
if (!csvArg) {
  console.error('Usage: node scripts/import-historical-nagaland.mjs <csv> [--apply]');
  process.exit(1);
}

const dataDir = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
const dbPath = path.join(dataDir, 'seekthethrill.db');
const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

try {
  const csv = readHistoricalCsv(csvArg);
  const result = apply
    ? importHistoricalCsv(csv, db, NAGALAND_HISTORICAL_CONFIG)
    : analyzeHistoricalCsv(csv, db, NAGALAND_HISTORICAL_CONFIG);
  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    tripSlug: NAGALAND_HISTORICAL_CONFIG.tripSlug,
    batchId: NAGALAND_HISTORICAL_CONFIG.batchId,
    counts: result.counts,
    inserted: result.inserted ?? 0,
    heldRows: result.heldRows,
    rejected: result.rejected,
    skipped: result.skipped,
    sideEffectsUnchanged: apply ? JSON.stringify(result.sideEffectsBefore) === JSON.stringify(result.sideEffectsAfter) : undefined,
  }, null, 2));
  if (result.rejected.length || result.duplicateEmails.length) process.exitCode = 1;
} finally {
  db.close();
}
