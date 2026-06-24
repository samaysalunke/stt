// One-time ops script — reconcile each trip's occupancy counters with reality.
//
// The `booked` (per-offer) and `bookedSpots` (per-batch) values in the trip YAML
// are hand-maintained counters that drift away from the real number of confirmed
// registrations (deletions, status edits and seed values never net back). This
// resets them to the live confirmed-registration count per batch + tier.
//
// Usage (run in the environment whose volume holds the data — e.g. prod):
//   node scripts/reconcile-booked.mjs            # dry run, prints what would change
//   node scripts/reconcile-booked.mjs --apply    # writes the corrected YAML
//
// Honours CONTENT_DIR and DATA_DIR (same env vars the app uses). Falls back to
// ./src/content and ./data for local runs.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import Database from 'better-sqlite3';

const APPLY = process.argv.includes('--apply');
const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../');
const CONTENT_DIR = process.env.CONTENT_DIR ?? path.join(ROOT, 'src', 'content');
const DATA_DIR = process.env.DATA_DIR ?? path.join(ROOT, 'data');
const TRIPS_DIR = path.join(CONTENT_DIR, 'trips');
const DB_PATH = path.join(DATA_DIR, 'seekthethrill.db');

if (!fs.existsSync(TRIPS_DIR)) {
  console.error(`[reconcile] No trips dir at ${TRIPS_DIR}`);
  process.exit(1);
}
if (!fs.existsSync(DB_PATH)) {
  console.error(`[reconcile] No database at ${DB_PATH}`);
  process.exit(1);
}

const db = new Database(DB_PATH, { readonly: true });
const confirmedForTier = db.prepare(
  "SELECT COUNT(*) AS n FROM registrations WHERE batch_id=? AND tier_id=? AND status='confirmed'",
);
const confirmedForBatch = db.prepare(
  "SELECT COUNT(*) AS n FROM registrations WHERE batch_id=? AND status='confirmed'",
);

console.log(`[reconcile] ${APPLY ? 'APPLY' : 'DRY RUN'} — content=${CONTENT_DIR} db=${DB_PATH}\n`);

let changedFiles = 0;
let changedCounters = 0;

for (const file of fs.readdirSync(TRIPS_DIR).filter((f) => f.endsWith('.yaml'))) {
  const filePath = path.join(TRIPS_DIR, file);
  const data = YAML.parse(fs.readFileSync(filePath, 'utf-8')) ?? {};
  const batches = Array.isArray(data.batches) ? data.batches : [];
  let fileChanged = false;

  for (const batch of batches) {
    const batchId = String(batch?.id ?? '');
    if (!batchId) continue;

    // Per-offer counters (new schema)
    if (Array.isArray(batch.offers)) {
      for (const offer of batch.offers) {
        const tierId = String(offer?.tierId ?? '');
        if (!tierId) continue;
        const real = confirmedForTier.get(batchId, tierId).n;
        const cur = Number(offer.booked) || 0;
        if (cur !== real) {
          console.log(`  ${file}  ${batchId}/${tierId}: booked ${cur} → ${real}`);
          offer.booked = real;
          fileChanged = true;
          changedCounters++;
        }
      }
    }

    // Per-batch counter (legacy schema + kept in sync regardless)
    const realBatch = confirmedForBatch.get(batchId).n;
    const curBatch = Number(batch.bookedSpots) || 0;
    if (batch.bookedSpots !== undefined && curBatch !== realBatch) {
      console.log(`  ${file}  ${batchId}: bookedSpots ${curBatch} → ${realBatch}`);
      batch.bookedSpots = realBatch;
      fileChanged = true;
      changedCounters++;
    }
  }

  if (fileChanged) {
    changedFiles++;
    if (APPLY) fs.writeFileSync(filePath, YAML.stringify(data), 'utf-8');
  }
}

db.close();
console.log(
  `\n[reconcile] ${changedCounters} counter(s) across ${changedFiles} file(s) ${APPLY ? 'updated' : 'would change'}.`,
);
if (!APPLY && changedCounters > 0) console.log('[reconcile] Re-run with --apply to write.');
