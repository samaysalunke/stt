/**
 * Canonicalises `registrations.city` for rows written before the write paths
 * normalised it.
 *
 * Same reason the column is normalised going forward: Bangalore and Bengaluru
 * are one city, and each spelling geocodes to its own cache entry, so two
 * travellers from the same place read as two different home points and the
 * admin drawer shows one of them as "Other".
 *
 * Only spellings `normalizeIndiaCity` recognises are rewritten. A city that is
 * simply not on the list is left exactly as typed — this never invents or
 * discards a place, it only picks one spelling of a place already named.
 *
 * Every change is written to a JSON backup and to audit_log, the same action
 * the customer drawer records, so it is traceable and reversible. Travellers
 * whose city actually changes get their leaderboard row recomputed — run
 * `npm run warm:geocode` first so the canonical spellings are resolvable.
 *
 * Usage: node scripts/normalize-registration-cities.mjs [--dry-run]
 */
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { buildCityNormalizer } from './lib/cityNormalizerFromSource.mjs';

const root = process.cwd();
const db = new Database(path.join(process.env.DATA_DIR ?? path.join(root, 'data'), 'seekthethrill.db'));
const dryRun = process.argv.includes('--dry-run');

// The matching itself lives in scripts/lib, rebuilt from the same source files
// the library uses, with a parity test against the real function. An inline
// copy here had already drifted once.
const normalize = buildCityNormalizer(root);

const rows = db.prepare(`SELECT id, email, full_name, city, status FROM registrations
  WHERE trim(COALESCE(city,'')) <> ''`).all();
const changes = rows
  .map((r) => ({ ...r, next: normalize(r.city) }))
  .filter((r) => r.next && r.next !== r.city);

const byPair = new Map();
for (const c of changes) {
  const k = `${c.city} -> ${c.next}`;
  byPair.set(k, (byPair.get(k) ?? 0) + 1);
}
for (const [pair, n] of [...byPair].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${dryRun ? 'would rewrite' : 'rewrote'} ${String(n).padStart(3)} row(s)  ${pair}`);
}
console.log(`\n${changes.length} of ${rows.length} row(s) need a change`);

if (dryRun) { console.log('(dry run, nothing written)'); db.close(); process.exit(0); }
if (!changes.length) { db.close(); process.exit(0); }

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = path.join(process.env.DATA_DIR ?? path.join(root, 'data'), `city-normalize-backup-${stamp}.json`);
fs.writeFileSync(backup, JSON.stringify(changes, null, 2));
console.log(`backed up to ${backup}`);

const update = db.prepare('UPDATE registrations SET city = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
const audit = db.prepare(`INSERT INTO audit_log
  (id, actorUserId, actorEmail, actorRole, action, targetType, targetId, previousValue, newValue, ipAddress)
  VALUES (?,?,?,?,?,?,?,?,?,?)`);
const apply = db.transaction((list) => {
  for (const c of list) {
    update.run(c.next, c.id);
    audit.run(crypto.randomUUID(), null, 'scripts/normalize-registration-cities', 'system',
      'customer.update', 'registration', String(c.id),
      JSON.stringify({ city: c.city }), JSON.stringify({ city: c.next }), null);
  }
});
apply(changes);

const emails = [...new Set(changes.map((c) => String(c.email).trim().toLowerCase()))];
console.log(JSON.stringify({ rowsChanged: changes.length, travellersAffected: emails.length }));
console.log('Next: npm run warm:geocode, then npm run backfill:profile-stats -- --all');
db.close();
