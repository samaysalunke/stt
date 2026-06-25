import crypto from 'node:crypto';
import { getDb } from '../db';

export interface AnalyticsAuditInput {
  sessionId?: string | null;
  ownerId: string;
  prompt: string;
  toolTier?: string | null;
  toolName?: string | null;
  toolInput?: unknown;
  piiAttemptDetected?: boolean;
  ambiguityResolved?: boolean;
  selectionMade?: unknown;
  resultRowCount?: number | null;
  error?: string | null;
  durationMs?: number | null;
}

export function createOrLoadSession(ownerId: string, conversationId?: string): string {
  const db = getDb();
  if (conversationId) {
    const row = db
      .prepare('SELECT id FROM analytics_sessions WHERE id = ? AND owner_id = ?')
      .get(conversationId, ownerId) as { id: string } | undefined;
    if (row) {
      db.prepare('UPDATE analytics_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(row.id);
      return row.id;
    }
  }
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO analytics_sessions (id, owner_id) VALUES (?, ?)').run(id, ownerId);
  return id;
}

export function appendAnalyticsMessage(params: {
  sessionId: string;
  role: 'user' | 'assistant' | 'tool';
  content?: string | null;
  toolName?: string | null;
  toolInput?: unknown;
  toolOutput?: unknown;
}): void {
  getDb()
    .prepare(
      `INSERT INTO analytics_messages (id, session_id, role, content, tool_name, tool_input, tool_output)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      crypto.randomUUID(),
      params.sessionId,
      params.role,
      params.content ?? null,
      params.toolName ?? null,
      params.toolInput == null ? null : JSON.stringify(params.toolInput),
      params.toolOutput == null ? null : JSON.stringify(params.toolOutput),
    );
}

export function loadAnalyticsHistory(sessionId: string): Array<{ role: string; content: string }> {
  return getDb()
    .prepare(
      `SELECT role, content, tool_name, tool_output
       FROM analytics_messages
       WHERE session_id = ?
       ORDER BY created_at ASC, id ASC
       LIMIT 30`,
    )
    .all(sessionId)
    .map((row: any) => ({
      role: row.role,
      content: row.content ?? (row.tool_name ? `${row.tool_name}: ${row.tool_output ?? ''}` : ''),
    }));
}

export function writeAnalyticsAudit(input: AnalyticsAuditInput): void {
  getDb()
    .prepare(
      `INSERT INTO analytics_audit_log (
        id, session_id, owner_id, prompt, tool_tier, tool_name, tool_input,
        pii_attempt_detected, ambiguity_resolved, selection_made, result_row_count,
        error, duration_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      crypto.randomUUID(),
      input.sessionId ?? null,
      input.ownerId,
      input.prompt,
      input.toolTier ?? null,
      input.toolName ?? null,
      input.toolInput == null ? null : JSON.stringify(input.toolInput),
      input.piiAttemptDetected ? 1 : 0,
      input.ambiguityResolved ? 1 : 0,
      input.selectionMade == null ? null : JSON.stringify(input.selectionMade),
      input.resultRowCount ?? null,
      input.error ?? null,
      input.durationMs ?? null,
    );
}

export function cleanupExpiredAnalyticsSessions(): number {
  const result = getDb()
    .prepare("DELETE FROM analytics_sessions WHERE datetime(updated_at) < datetime('now', '-24 hours')")
    .run();
  return result.changes;
}
