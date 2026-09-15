// The webhook as the real server exposes it. The authorization matrix is covered
// in tests/unit/telegramWebhook.test.ts — proving it end-to-end would need a real
// TELEGRAM_BOT_TOKEN in this server's environment, which would make
// telegram-notifications.test.mjs actually dial api.telegram.org.
//
// What this file proves is what only a live server can: the route is reachable,
// middleware does not redirect or CSRF-block it, and it refuses without a secret.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiPost, BASE } from './helpers.mjs';

const UPDATE = {
  update_id: 999000001,
  callback_query: {
    id: 'qa-cbq-1', data: 'b:1:cf:advance_paid',
    from: { id: '999999', first_name: 'QA' },
    message: { message_id: 1, chat: { id: '-100000' } },
  },
};

test('the webhook is routed and is not behind the admin session gate', async () => {
  const { status } = await apiPost('/api/telegram/webhook', UPDATE);
  // 401 is the unconfigured/unauthenticated answer. A 404 would mean the route
  // never shipped; a 302 would mean middleware swallowed it.
  assert.equal(status, 401);
});

test('a POST with no Origin is not treated as a cross-site form submission', async () => {
  const res = await fetch(`${BASE}/api/telegram/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(UPDATE),
    redirect: 'manual',
  });
  assert.equal(res.status, 401);
  assert.notEqual(res.status, 403);
});

test('rejects a bogus secret header the same way as none at all', async () => {
  const { status } = await apiPost('/api/telegram/webhook', UPDATE, {
    headers: { 'x-telegram-bot-api-secret-token': 'definitely-not-the-secret' },
  });
  assert.equal(status, 401);
});
