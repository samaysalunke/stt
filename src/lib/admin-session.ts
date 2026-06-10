import crypto from 'node:crypto';
import { getDb } from './db';

const SESSION_TTL = 8 * 60 * 60;      // 8 hours absolute
const IDLE_TIMEOUT = 2 * 60 * 60;     // 2 hours idle

export interface AdminUser {
  userId: string;
  email: string;
  displayName: string | null;
  role: 'owner' | 'ops' | 'trip_lead';
  tripIds: string[];
}

const ROLE_RANK: Record<string, number> = { owner: 3, ops: 2, trip_lead: 1 };

export function createAdminSession(userId: string, ipAddress?: string): string {
  const db = getDb();
  const id = crypto.randomUUID();
  const token = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    INSERT INTO admin_sessions (id, userId, token, expiresAt, lastActivityAt, ipAddress)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, userId, token, now + SESSION_TTL, now, ipAddress ?? null);
  return token;
}

export function getAdminBySession(token: string): AdminUser | null {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const row = db.prepare(`
    SELECT s.id as sessionId, s.userId, s.lastActivityAt, s.expiresAt,
           u.email, u.displayName
    FROM admin_sessions s
    JOIN users u ON u.id = s.userId
    WHERE s.token = ? AND s.expiresAt > ?
  `).get(token, now) as any;

  if (!row) return null;

  // Idle timeout check
  if (now - row.lastActivityAt > IDLE_TIMEOUT) {
    db.prepare('DELETE FROM admin_sessions WHERE id = ?').run(row.sessionId);
    return null;
  }

  // Bump lastActivityAt
  db.prepare('UPDATE admin_sessions SET lastActivityAt = ? WHERE id = ?').run(now, row.sessionId);

  // Resolve highest-privilege role
  const roles = db.prepare(`
    SELECT role, tripIds FROM user_roles WHERE userId = ?
  `).all(row.userId) as Array<{ role: string; tripIds: string }>;

  if (roles.length === 0) return null;

  const top = roles.sort((a, b) => (ROLE_RANK[b.role] ?? 0) - (ROLE_RANK[a.role] ?? 0))[0];
  let tripIds: string[] = [];
  try { tripIds = JSON.parse(top.tripIds ?? '[]'); } catch {}

  return {
    userId: row.userId,
    email: row.email,
    displayName: row.displayName ?? null,
    role: top.role as AdminUser['role'],
    tripIds,
  };
}

export function deleteAdminSession(token: string): void {
  getDb().prepare('DELETE FROM admin_sessions WHERE token = ?').run(token);
}

export function upsertAdminUser(params: {
  id: string;
  email: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  googleId: string;
}): void {
  getDb().prepare(`
    INSERT INTO users (id, email, displayName, avatarUrl, googleId, lastLoginAt)
    VALUES (?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(googleId) DO UPDATE SET
      displayName = excluded.displayName,
      avatarUrl   = excluded.avatarUrl,
      lastLoginAt = unixepoch()
  `).run(params.id, params.email, params.displayName ?? null, params.avatarUrl ?? null, params.googleId);
}

export function getUserIdByGoogleId(googleId: string): string | null {
  const row = getDb().prepare('SELECT id FROM users WHERE googleId = ?').get(googleId) as any;
  return row?.id ?? null;
}

export function getUserRoles(userId: string): Array<{ role: string; tripIds: string }> {
  return getDb().prepare('SELECT role, tripIds FROM user_roles WHERE userId = ?').all(userId) as any;
}

export function assignRole(params: {
  userId: string;
  role: string;
  tripIds?: string[];
  assignedBy?: string;
}): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO user_roles (userId, role, tripIds, assignedBy)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(userId, role) DO UPDATE SET
      tripIds    = excluded.tripIds,
      assignedBy = excluded.assignedBy,
      assignedAt = unixepoch()
  `).run(params.userId, params.role, JSON.stringify(params.tripIds ?? []), params.assignedBy ?? null);
}

export function removeRole(userId: string, role: string): void {
  getDb().prepare('DELETE FROM user_roles WHERE userId = ? AND role = ?').run(userId, role);
}

export function countOwners(): number {
  const row = getDb().prepare("SELECT COUNT(*) as n FROM user_roles WHERE role = 'owner'").get() as any;
  return row?.n ?? 0;
}

export function listAdminUsers(): Array<{
  userId: string; email: string; displayName: string | null;
  role: string; tripIds: string; assignedBy: string | null; assignedAt: number;
}> {
  return getDb().prepare(`
    SELECT r.userId, u.email, u.displayName, r.role, r.tripIds, r.assignedBy, r.assignedAt
    FROM user_roles r
    JOIN users u ON u.id = r.userId
    ORDER BY r.assignedAt ASC
  `).all() as any;
}
