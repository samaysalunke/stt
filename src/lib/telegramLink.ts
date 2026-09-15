/**
 * Telegram account ↔ admin identity.
 *
 * A callback_query carries `from.id`, the numeric Telegram user id of whoever
 * tapped. That id is trustworthy — it reaches us through our own secret-guarded
 * webhook, not from the client — but it is not an authorization: the bot posts
 * into a group, so *anyone in that group* can tap a button. These functions are
 * what turn an id into an admin, and refuse when it is nobody.
 *
 * The role is deliberately not stored on the link. It is read from `user_roles`
 * on every tap, so removing someone in /admin/settings/roles stops their buttons
 * working immediately — there is no second revocation step to forget.
 */
import crypto from 'node:crypto';
import { getDb } from './db';

/** Matches ROLE_RANK in admin-session.ts — highest privilege wins. */
const ROLE_RANK: Record<string, number> = { owner: 3, ops: 2, trip_lead: 1 };

const TOKEN_TTL_MS = 10 * 60_000;

const hash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

export interface TelegramActor {
  userId: string;
  email: string;
  displayName: string | null;
  role: 'owner' | 'ops' | 'trip_lead';
  telegramUserId: string;
}

/**
 * Mint a one-time deep-link token for an admin. The plaintext is returned once,
 * for the t.me URL; only its hash is persisted.
 */
export function createLinkToken(userId: string): string {
  const token = crypto.randomBytes(24).toString('base64url');
  const db = getDb();
  // One live token per admin: minting a new one invalidates any outstanding URL.
  db.prepare('DELETE FROM telegram_link_tokens WHERE user_id=? AND consumed_at IS NULL').run(userId);
  db.prepare(`
    INSERT INTO telegram_link_tokens (token_hash, user_id, expires_at)
    VALUES (?, ?, datetime('now', '+${Math.round(TOKEN_TTL_MS / 1000)} seconds'))
  `).run(hash(token), userId);
  return token;
}

export type LinkResult =
  | { ok: true; userId: string }
  | { ok: false; reason: 'unknown_token' | 'expired' | 'already_used' };

/**
 * Consume a token and bind the Telegram account to that admin.
 *
 * The claim is a compare-and-swap on `consumed_at`, so two people racing the
 * same URL cannot both link — the loser is told the token is used.
 */
export function consumeLinkToken(
  token: string,
  telegramUserId: string,
  telegramUsername?: string | null,
): LinkResult {
  const db = getDb();
  return db.transaction((): LinkResult => {
    const row = db.prepare(
      'SELECT user_id, consumed_at, expires_at <= CURRENT_TIMESTAMP AS expired FROM telegram_link_tokens WHERE token_hash=?',
    ).get(hash(token)) as { user_id: string; consumed_at: string | null; expired: number } | undefined;
    if (!row) return { ok: false, reason: 'unknown_token' as const };
    if (row.consumed_at) return { ok: false, reason: 'already_used' as const };
    if (row.expired) return { ok: false, reason: 'expired' as const };

    const claimed = db.prepare(
      'UPDATE telegram_link_tokens SET consumed_at=CURRENT_TIMESTAMP WHERE token_hash=? AND consumed_at IS NULL',
    ).run(hash(token)).changes;
    if (!claimed) return { ok: false, reason: 'already_used' as const };

    // Re-linking the same Telegram account, or the same admin from a new
    // account, replaces the previous binding rather than stacking.
    db.prepare('DELETE FROM telegram_admin_links WHERE user_id=?').run(row.user_id);
    db.prepare(`
      INSERT INTO telegram_admin_links (telegram_user_id, user_id, telegram_username)
      VALUES (?, ?, ?)
      ON CONFLICT(telegram_user_id) DO UPDATE SET
        user_id=excluded.user_id, telegram_username=excluded.telegram_username,
        linked_at=CURRENT_TIMESTAMP, revoked_at=NULL
    `).run(String(telegramUserId), row.user_id, telegramUsername ?? null);
    return { ok: true, userId: row.user_id as string };
  })();
}

/**
 * The admin behind a Telegram user id, or null for anyone unlinked, revoked, or
 * holding no role. Callers must treat null as "not authorized", never as "no
 * information".
 */
export function resolveTelegramActor(telegramUserId: string | number): TelegramActor | null {
  const db = getDb();
  const link = db.prepare(`
    SELECT l.telegram_user_id, l.user_id, u.email, u.displayName
    FROM telegram_admin_links l
    JOIN users u ON u.id = l.user_id
    WHERE l.telegram_user_id=? AND l.revoked_at IS NULL
  `).get(String(telegramUserId)) as
    { telegram_user_id: string; user_id: string; email: string; displayName: string | null } | undefined;
  if (!link) return null;

  const roles = db.prepare('SELECT role FROM user_roles WHERE userId=?').all(link.user_id) as Array<{ role: string }>;
  if (!roles.length) return null;
  const top = roles.sort((a, b) => (ROLE_RANK[b.role] ?? 0) - (ROLE_RANK[a.role] ?? 0))[0];

  return {
    userId: link.user_id,
    email: link.email,
    displayName: link.displayName ?? null,
    role: top.role as TelegramActor['role'],
    telegramUserId: link.telegram_user_id,
  };
}

export function revokeLinkForUser(userId: string): boolean {
  return getDb().prepare('DELETE FROM telegram_admin_links WHERE user_id=?').run(userId).changes > 0;
}

export function linkForUser(userId: string):
  | { telegramUserId: string; telegramUsername: string | null; linkedAt: string }
  | null {
  const row = getDb().prepare(
    'SELECT telegram_user_id, telegram_username, linked_at FROM telegram_admin_links WHERE user_id=? AND revoked_at IS NULL',
  ).get(userId) as any;
  return row
    ? { telegramUserId: row.telegram_user_id, telegramUsername: row.telegram_username, linkedAt: row.linked_at }
    : null;
}

/**
 * Record an update_id, returning false if it has been seen before.
 *
 * Telegram redelivers updates it believes failed. A redelivered callback must
 * not re-run a state change, so every update is claimed exactly once here before
 * anything acts on it.
 */
export function claimUpdateId(updateId: number): boolean {
  if (!Number.isFinite(updateId)) return true;
  const changes = getDb()
    .prepare('INSERT OR IGNORE INTO telegram_updates_seen (update_id) VALUES (?)')
    .run(Math.trunc(updateId)).changes;
  if (changes) {
    // Bounded: the guard only has to outlive Telegram's retry window.
    getDb().prepare(
      "DELETE FROM telegram_updates_seen WHERE received_at < datetime('now', '-2 days')",
    ).run();
  }
  return changes === 1;
}
