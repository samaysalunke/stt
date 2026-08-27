import crypto from 'node:crypto';
import { getDb } from './db';

export interface SessionUser {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  phone: string | null;
}

const SESSION_TTL = 30 * 24 * 60 * 60; // 30 days in seconds

export function createUserSession(userId: string): string {
  const db = getDb();
  const token = crypto.randomUUID();
  const id = crypto.randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL;
  db.prepare(
    'INSERT INTO user_sessions (id, userId, token, expiresAt) VALUES (?, ?, ?, ?)'
  ).run(id, userId, token, expiresAt);
  return token;
}

export function getUserBySession(token: string): SessionUser | null {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const row = db.prepare(`
    SELECT u.id, u.email, u.displayName, u.avatarUrl, u.phone
    FROM user_sessions s
    JOIN users u ON u.id = s.userId
    WHERE s.token = ? AND s.expiresAt > ?
  `).get(token, now) as SessionUser | undefined;
  return row ?? null;
}

export function deleteUserSession(token: string): void {
  getDb().prepare('DELETE FROM user_sessions WHERE token = ?').run(token);
}

export function cleanExpiredSessions(): void {
  const now = Math.floor(Date.now() / 1000);
  getDb().prepare('DELETE FROM user_sessions WHERE expiresAt < ?').run(now);
}
