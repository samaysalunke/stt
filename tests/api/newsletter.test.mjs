// TC-004 to TC-006 — POST /api/newsletter
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiPost } from './helpers.mjs';

async function subscribe(email) {
  return apiPost('/api/newsletter', { email });
}

test('TC-004 valid email → success', async () => {
  const { status, data } = await subscribe('qa-newsletter@example.invalid');
  assert.equal(status, 200);
  assert.equal(data.success, true);
});

test('TC-005 invalid email → 400', async () => {
  const { status, data } = await subscribe('notanemail');
  assert.equal(status, 400);
  assert.equal(data.success, false);
  assert.match(data.error, /email/i);
});

test('TC-005 empty email → 400', async () => {
  const { status, data } = await subscribe('');
  assert.equal(status, 400);
  assert.equal(data.success, false);
});

test('TC-006 duplicate email is idempotent → success', async () => {
  const email = 'qa-dup@example.invalid';
  await subscribe(email);
  const { status, data } = await subscribe(email);
  assert.equal(status, 200);
  assert.equal(data.success, true);
});
