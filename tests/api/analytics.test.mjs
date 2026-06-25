// Analytics chatbot API auth + SSE smoke tests
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { adminLogin, BASE } from './helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const DB_PATH = path.resolve(__dirname, '../../data/seekthethrill.db');

function seedAdminSession(role) {
  const Database = require('better-sqlite3');
  const db = new Database(DB_PATH);
  const id = crypto.randomUUID();
  const token = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    INSERT OR IGNORE INTO users (id, email, displayName, googleId, createdAt)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, `analytics-${role}-${id.slice(0, 8)}@example.invalid`, `Analytics ${role}`, `analytics-google-${id}`, now);
  db.prepare(`
    INSERT OR REPLACE INTO user_roles (userId, role, tripIds, assignedAt)
    VALUES (?, ?, '[]', ?)
  `).run(id, role, now);
  db.prepare(`
    INSERT INTO admin_sessions (id, userId, token, expiresAt, lastActivityAt)
    VALUES (?, ?, ?, ?, ?)
  `).run(crypto.randomUUID(), id, token, now + 8 * 3600, now);
  db.close();
  return `admin_token=${token}`;
}

async function postChat(cookie) {
  return fetch(`${BASE}/api/admin/analytics/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ message: 'What is the male vs female ratio across all trips?' }),
    redirect: 'manual',
  });
}

function parseSse(text) {
  return text.trim().split('\n\n').filter(Boolean).map((chunk) => {
    const lines = chunk.split('\n');
    const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim();
    const data = lines.find((line) => line.startsWith('data:'))?.slice(5).trim();
    return { event, data: data ? JSON.parse(data) : null };
  });
}

test('AN-API unauthenticated chat → 401', async () => {
  const res = await postChat('');
  assert.equal(res.status, 401);
});

test('AN-API ops chat → 403', async () => {
  const res = await postChat(seedAdminSession('ops'));
  assert.equal(res.status, 403);
});

test('AN-API owner chat streams a final event', async () => {
  const { cookie } = await adminLogin('changeme');
  const res = await postChat(cookie);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);
  const text = await res.text();
  const events = parseSse(text);
  const final = events.find((event) => event.event === 'final');
  assert.ok(final?.data?.conversationId, 'expected a conversation id in the final event');
  assert.match(final.data.answer ?? '', /Fake LLM analytics answer/);
  assert.equal(final.data.error, undefined);
});
