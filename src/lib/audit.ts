import crypto from 'node:crypto';
import { getDb } from './db';

export function logAction(params: {
  actorUserId?: string | null;
  actorEmail?: string | null;
  actorRole?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  previousValue?: unknown;
  newValue?: unknown;
  ipAddress?: string;
}): void {
  try {
    getDb().prepare(`
      INSERT INTO audit_log (id, actorUserId, actorEmail, actorRole, action, targetType, targetId, previousValue, newValue, ipAddress)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      params.actorUserId ?? null,
      params.actorEmail ?? null,
      params.actorRole ?? null,
      params.action,
      params.targetType ?? null,
      params.targetId ?? null,
      params.previousValue != null ? JSON.stringify(params.previousValue) : null,
      params.newValue != null ? JSON.stringify(params.newValue) : null,
      params.ipAddress ?? null,
    );
  } catch {
    // Audit failures must never block the primary action
  }
}
