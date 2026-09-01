/**
 * Load the fixed visual-baseline dataset into an isolated database.
 *
 * Run against `DATA_DIR` — never the shared dev database. The visual Playwright
 * project boots its own dev server on a separate port with
 * `DATA_DIR=.visual-data` for exactly this reason: the admin baselines assert
 * badge colours, and badge colour comes from row data, so the rows have to be
 * the same on every run and on every machine.
 *
 * The schema is NOT created here. `src/lib/db.ts` owns it, and duplicating the
 * DDL in a test fixture is how the two drift apart. The seed refuses to run
 * until the app has created the tables (the setup project pokes the server
 * first), and it only writes columns the live schema actually has, so a
 * migration that adds one does not break the fixture.
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { TABLES, WIPE_ONLY } from '../tests/e2e/fixtures/visual-dataset.mjs';

const DATA_DIR = process.env.DATA_DIR;
if (!DATA_DIR) {
  console.error('[visual-seed] DATA_DIR is required. Refusing to guess, because the default would be the shared dev database.');
  process.exit(1);
}
if (path.resolve(DATA_DIR) === path.resolve(process.cwd(), 'data')) {
  console.error('[visual-seed] DATA_DIR points at ./data, the shared dev database. Refusing.');
  process.exit(1);
}

const dbPath = path.join(DATA_DIR, 'seekthethrill.db');
if (!fs.existsSync(dbPath)) {
  console.error(`[visual-seed] No database at ${dbPath}. Start the visual dev server once so it creates the schema, then re-run.`);
  process.exit(1);
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const tableExists = (name) =>
  db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name) !== undefined;

const missing = Object.keys(TABLES).filter((t) => !tableExists(t));
if (missing.length > 0) {
  console.error(`[visual-seed] Schema not initialised — missing ${missing.join(', ')}. The dev server creates tables lazily on its first request; hit a page, then re-run.`);
  process.exit(1);
}

const seed = db.transaction(() => {
  for (const name of [...Object.keys(TABLES), ...WIPE_ONLY]) {
    if (tableExists(name)) db.prepare(`DELETE FROM ${name}`).run();
  }
  // Reset AUTOINCREMENT so registration ids are 1..n on every run: they show up
  // in admin URLs and in audit_log.targetId.
  if (tableExists('sqlite_sequence')) db.prepare(`DELETE FROM sqlite_sequence`).run();

  let inserted = 0;
  for (const [table, rows] of Object.entries(TABLES)) {
    const live = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
    for (const row of rows) {
      const cols = Object.keys(row).filter((c) => live.has(c));
      const unknown = Object.keys(row).filter((c) => !live.has(c));
      if (unknown.length > 0) {
        console.warn(`[visual-seed] ${table}: skipping column(s) not in the live schema — ${unknown.join(', ')}`);
      }
      db.prepare(
        `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      ).run(...cols.map((c) => row[c]));
      inserted += 1;
    }
  }
  return inserted;
});

const count = seed();
db.close();
console.log(`[visual-seed] ${dbPath}: ${count} rows across ${Object.keys(TABLES).length} tables, ${WIPE_ONLY.length} volatile tables cleared.`);
