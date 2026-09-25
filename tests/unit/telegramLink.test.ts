import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

let db: Database.Database;
vi.mock('../../src/lib/db', () => ({ getDb: () => db }));

const {
  claimUpdateId, consumeLinkToken, createLinkToken, resolveTelegramActor,
} = await import('../../src/lib/telegramLink');

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, displayName TEXT);
    CREATE TABLE user_roles (userId TEXT, role TEXT, PRIMARY KEY (userId, role));
    CREATE TABLE telegram_admin_links (
      telegram_user_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, telegram_username TEXT,
      linked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, revoked_at DATETIME
    );
    CREATE TABLE telegram_link_tokens (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at DATETIME NOT NULL,
      consumed_at DATETIME, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE telegram_updates_seen (
      update_id INTEGER PRIMARY KEY, received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO users VALUES ('u-ops', 'ops@example.invalid', 'Ops Person');
    INSERT INTO users VALUES ('u-lead', 'lead@example.invalid', 'Trip Lead');
    INSERT INTO users VALUES ('u-none', 'none@example.invalid', 'No Role');
    INSERT INTO user_roles VALUES ('u-ops', 'ops');
    INSERT INTO user_roles VALUES ('u-lead', 'trip_lead');
  `);
});

describe('link tokens', () => {
  /** The plaintext lives only in the t.me URL — a leaked row must not be replayable. */
  it('never stores the token itself', () => {
    const token = createLinkToken('u-ops');
    const rows = db.prepare('SELECT token_hash FROM telegram_link_tokens').all() as Array<{ token_hash: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).not.toContain(token);
    expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is single use — a second attempt cannot link a different account', () => {
    const token = createLinkToken('u-ops');
    expect(consumeLinkToken(token, '55501').ok).toBe(true);
    expect(consumeLinkToken(token, '99999')).toEqual({ ok: false, reason: 'already_used' });
    expect(resolveTelegramActor('99999')).toBeNull();
  });

  it('refuses an unknown or expired token', () => {
    expect(consumeLinkToken('not-a-real-token', '55501')).toEqual({ ok: false, reason: 'unknown_token' });
    const token = createLinkToken('u-ops');
    db.prepare("UPDATE telegram_link_tokens SET expires_at = datetime('now','-1 minute')").run();
    expect(consumeLinkToken(token, '55501')).toEqual({ ok: false, reason: 'expired' });
  });

  it('invalidates an outstanding URL when a new one is minted', () => {
    const first = createLinkToken('u-ops');
    createLinkToken('u-ops');
    expect(consumeLinkToken(first, '55501')).toEqual({ ok: false, reason: 'unknown_token' });
  });

  it('moves the admin to a new Telegram account rather than stacking links', () => {
    consumeLinkToken(createLinkToken('u-ops'), '55501');
    consumeLinkToken(createLinkToken('u-ops'), '77702');
    expect(resolveTelegramActor('55501')).toBeNull();
    expect(resolveTelegramActor('77702')).toMatchObject({ userId: 'u-ops' });
  });
});

describe('resolveTelegramActor', () => {
  it('returns the admin, with the role read live rather than stored', () => {
    consumeLinkToken(createLinkToken('u-ops'), '55501');
    expect(resolveTelegramActor('55501')).toMatchObject({
      userId: 'u-ops', email: 'ops@example.invalid', displayName: 'Ops Person', role: 'ops',
    });

    // Revoking in /admin/settings/roles must take effect on the very next tap,
    // with no second revocation step to forget.
    db.prepare("DELETE FROM user_roles WHERE userId='u-ops'").run();
    expect(resolveTelegramActor('55501')).toBeNull();
  });

  it('picks the highest-privilege role', () => {
    db.prepare("INSERT INTO user_roles VALUES ('u-ops','owner')").run();
    consumeLinkToken(createLinkToken('u-ops'), '55501');
    expect(resolveTelegramActor('55501')?.role).toBe('owner');
  });

  it('is null for anyone unlinked, revoked, or holding no role', () => {
    expect(resolveTelegramActor('00000')).toBeNull();

    consumeLinkToken(createLinkToken('u-none'), '31337');
    expect(resolveTelegramActor('31337'), 'linked but roleless').toBeNull();

    consumeLinkToken(createLinkToken('u-ops'), '55501');
    db.prepare("UPDATE telegram_admin_links SET revoked_at=CURRENT_TIMESTAMP").run();
    expect(resolveTelegramActor('55501'), 'revoked link').toBeNull();
  });
});

describe('claimUpdateId', () => {
  it('claims an update once, so a Telegram redelivery cannot re-run a change', () => {
    expect(claimUpdateId(1001)).toBe(true);
    expect(claimUpdateId(1001)).toBe(false);
    expect(claimUpdateId(1002)).toBe(true);
  });
});
