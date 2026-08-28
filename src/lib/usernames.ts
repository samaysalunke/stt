import { getDb } from './db';
import crypto from 'node:crypto';

const RESERVED = new Set([
  'admin', 'owner', 'root', 'api', 'login', 'logout', 'register', 'profile',
  'leaderboard', 'trips', 'about', 'contact', 'me', 'null', 'undefined',
  'system', 'support', 'help', 'team', 'seekthethrill', 'stt', 'user', 'users',
]);

// 3-30 chars, a-z 0-9 hyphens/underscores, must start/end with alphanumeric
const USERNAME_RE = /^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$|^[a-z0-9]{1,30}$/;

export function validateUsername(username: string): string | null {
  if (!username) return 'Username is required.';
  if (username.length < 3) return 'Username must be at least 3 characters.';
  if (username.length > 30) return 'Username must be 30 characters or fewer.';
  if (!USERNAME_RE.test(username)) return 'Use only letters, numbers, hyphens, and underscores (start and end with a letter or number).';
  if (RESERVED.has(username)) return 'That username is reserved.';
  return null;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20);
}

export function isUsernameAvailable(username: string, excludeUserId?: string): boolean {
  const db = getDb();
  const alias = db.prepare('SELECT userId FROM username_aliases WHERE username = ? COLLATE NOCASE')
    .get(username) as { userId: string } | undefined;
  if (alias && alias.userId !== excludeUserId) return false;
  // An owner's own old alias is also permanently reserved: it must never become
  // the current name again or be handed to another account.
  if (alias) return false;
  if (excludeUserId) {
    const row = db
      .prepare('SELECT id FROM users WHERE username = ? AND id != ?')
      .get(username, excludeUserId) as { id: string } | undefined;
    return !row;
  }
  const row = db
    .prepare('SELECT id FROM users WHERE username = ?')
    .get(username) as { id: string } | undefined;
  return !row;
}

export function generateUsername(displayName: string): string {
  const base = slugify(displayName) || 'traveller';
  // Ensure minimum length
  const padded = base.length < 3 ? base.padEnd(3, '0') : base;

  if (isUsernameAvailable(padded) && !RESERVED.has(padded)) return padded;

  // Append random 4-char suffix until unique
  for (let i = 0; i < 20; i++) {
    const suffix = crypto.randomBytes(2).toString('hex');
    const candidate = `${padded.slice(0, 24)}-${suffix}`;
    if (isUsernameAvailable(candidate)) return candidate;
  }

  // Fallback: full random
  return `traveller-${crypto.randomBytes(4).toString('hex')}`;
}

export function assignAutoUsername(userId: string, displayName: string): string | null {
  const db = getDb();
  const existing = db
    .prepare('SELECT username FROM users WHERE id = ?')
    .get(userId) as { username: string | null } | undefined;

  if (existing?.username) return existing.username;

  const username = generateUsername(displayName ?? 'traveller');
  try {
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run(username, userId);
    return username;
  } catch {
    return null;
  }
}

export function setUsername(
  userId: string,
  username: string
): { success: boolean; error?: string } {
  const err = validateUsername(username);
  if (err) return { success: false, error: err };

  if (!isUsernameAvailable(username, userId)) {
    return { success: false, error: 'That username is already taken.' };
  }

  const db = getDb();
  const row = db
    .prepare('SELECT username, usernameChangedAt FROM users WHERE id = ?')
    .get(userId) as { username: string | null; usernameChangedAt: number | null } | undefined;

  if (!row) return { success: false, error: 'User not found.' };

  // Allow one manual change (auto-assigned doesn't count as a change)
  if (row.usernameChangedAt != null) {
    return { success: false, error: 'You can only change your username once.' };
  }

  if (row.username === username) return { success: true };

  const now = Math.floor(Date.now() / 1000);
  try {
    db.transaction(() => {
      if (row.username) {
        db.prepare('INSERT INTO username_aliases (username, userId) VALUES (?, ?)').run(row.username, userId);
      }
      db.prepare('UPDATE users SET username = ?, usernameChangedAt = ? WHERE id = ?').run(username, now, userId);
      db.prepare('UPDATE leaderboard_cache SET username = ? WHERE userId = ?').run(username, userId);
    })();
  } catch (error: any) {
    if (String(error?.code).includes('CONSTRAINT')) return { success: false, error: 'That username is already taken.' };
    return { success: false, error: 'Could not save that username. Please try again.' };
  }

  return { success: true };
}

export function resolveUsernameAlias(username: string): { userId: string } | null {
  return getDb().prepare('SELECT userId FROM username_aliases WHERE username = ? COLLATE NOCASE')
    .get(username) as { userId: string } | undefined ?? null;
}
