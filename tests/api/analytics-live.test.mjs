// Optional live LLM smoke test. Run with:
// ANALYTICS_LLM_PROVIDER=... ANALYTICS_LLM_MODEL=... ANALYTICS_LLM_API_KEY=... npm run test:analytics-live

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adminLogin, BASE } from './helpers.mjs';

const BLOCKED_COLUMNS = new Set([
  'full_name',
  'email',
  'phone',
  'address',
  'emergency_name',
  'emergency_phone',
  'admin_notes',
  'transaction_id',
  'payment_screenshot_url',
]);

function parseSse(text) {
  return text.trim().split('\n\n').filter(Boolean).map((chunk) => {
    const lines = chunk.split('\n');
    const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim();
    const data = lines.find((line) => line.startsWith('data:'))?.slice(5).trim();
    return { event, data: data ? JSON.parse(data) : null };
  });
}

async function liveChat(message) {
  const { cookie } = await adminLogin(process.env.ADMIN_PASSWORD || 'changeme');
  const res = await fetch(`${BASE}/api/admin/analytics/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ message }),
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);
  return parseSse(await res.text());
}

test('AN-LIVE owner chat streams a successful LLM answer', async () => {
  const events = await liveChat('What is the male vs female ratio across all trips?');
  const tokens = events.filter((event) => event.event === 'token');
  const final = events.find((event) => event.event === 'final');

  assert.ok(tokens.length > 0, 'expected at least one streamed token from the live provider');
  assert.ok(final?.data?.conversationId, 'expected final conversation id');
  assert.equal(final.data.error, undefined);
  assert.ok(String(final.data.answer || '').trim().length > 0, 'expected non-empty final answer');
  assert.ok(final.data.data?.columns?.length > 0, 'expected returned data columns');

  for (const column of final.data.data.columns) {
    assert.equal(BLOCKED_COLUMNS.has(String(column)), false, `blocked PII column returned: ${column}`);
  }
});
