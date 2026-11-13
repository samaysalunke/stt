import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { uniqueDepartureIds } from '../../src/lib/departureIds';

describe('uniqueDepartureIds', () => {
  test('re-keys a copied departure whose id another trip already uses', () => {
    const out = uniqueDepartureIds(
      [{ id: 'south-goa-2026-09-10', startDate: '2026-12-29' }, { id: '2026-10-22', startDate: '2026-10-22' }],
      { slug: 'south-goa-new-year', taken: new Set(['south-goa-2026-09-10', '2026-10-22']) },
    );
    expect(out.map((b) => b.id)).toEqual(['south-goa-new-year-2026-12-29', 'south-goa-new-year-2026-10-22']);
  });

  test('keeps existing ids even when they clash, so their registrations still match', () => {
    const out = uniqueDepartureIds(
      [{ id: 'shared', startDate: '2026-12-29' }, { id: 'shared-new', startDate: '2027-01-05' }],
      { slug: 'trip', taken: new Set(['shared', 'shared-new']), keep: new Set(['shared']) },
    );
    expect(out.map((b) => b.id)).toEqual(['shared', 'trip-2027-01-05']);
  });

  test('fills blank ids and never reuses an id within the same trip', () => {
    const out = uniqueDepartureIds(
      [{ id: '', startDate: '2027-03-01' }, { id: '', startDate: '2027-03-01' }, { id: 'free', startDate: '2027-04-01' }],
      { slug: 'trip', taken: new Set(['trip-2027-03-01']) },
    );
    expect(out.map((b) => b.id)).toEqual(['trip-2027-03-01-2', 'trip-2027-03-01-3', 'free']);
  });
});

describe('recordTripSlugAlias', () => {
  let tempDir: string;
  let db: any;
  let aliases: typeof import('../../src/lib/tripSlugAliases');

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stt-rename-'));
    process.env.DATA_DIR = tempDir;
    vi.resetModules();
    db = (await import('../../src/lib/db')).getDb();
    aliases = await import('../../src/lib/tripSlugAliases');
  });

  afterAll(() => {
    db?.close();
    delete process.env.DATA_DIR;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('moves registrations and saved trips to the new slug', () => {
    db.prepare("INSERT INTO users (id, email, googleId) VALUES ('u1', 'a@example.com', 'g1'), ('u2', 'b@example.com', 'g2')").run();
    const reg = db.prepare(`INSERT INTO registrations (trip_slug, batch_id, trip_name, full_name, email, phone, emergency_name, emergency_phone, status)
      VALUES (?, ?, 'Goa', 'Asha', ?, '9', 'Ravi', '8', 'confirmed')`);
    reg.run('goa-copy', 'b1', 'a@example.com');
    reg.run('other', 'b9', 'c@example.com');
    // u1 saved both slugs: must end with one row, not a primary-key clash.
    db.prepare("INSERT INTO saved_trips (userId, trip_slug) VALUES ('u1', 'goa-copy'), ('u1', 'goa-new-year'), ('u2', 'goa-copy')").run();

    aliases.recordTripSlugAlias('goa-copy', 'goa-new-year');

    expect(db.prepare("SELECT trip_slug FROM registrations WHERE batch_id = 'b1'").get().trip_slug).toBe('goa-new-year');
    expect(db.prepare("SELECT trip_slug FROM registrations WHERE batch_id = 'b9'").get().trip_slug).toBe('other');
    expect(db.prepare("SELECT userId, trip_slug FROM saved_trips ORDER BY userId").all()).toEqual([
      { userId: 'u1', trip_slug: 'goa-new-year' },
      { userId: 'u2', trip_slug: 'goa-new-year' },
    ]);
    expect(aliases.resolveTripSlugAlias('goa-copy')).toBe('goa-new-year');
  });

  test('a rename chain still redirects the first slug straight to the latest', () => {
    aliases.recordTripSlugAlias('goa-new-year', 'goa-new-year-2026');
    expect(aliases.resolveTripSlugAlias('goa-copy')).toBe('goa-new-year-2026');
    expect(db.prepare("SELECT trip_slug FROM registrations WHERE batch_id = 'b1'").get().trip_slug).toBe('goa-new-year-2026');
  });
});
