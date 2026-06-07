// TC-040 to TC-044 — POST /api/contact
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiPost } from './helpers.mjs';

const VALID_CONTACT = {
  fullName: 'QA Tester',
  email:    'qa-contact@example.invalid',
  phone:    '9876543210',
  subject:  'QA automated test',
  message:  'This is an automated QA test message. Please ignore.',
  source:   'qa-test',
};

async function contact(overrides = {}) {
  return apiPost('/api/contact', { ...VALID_CONTACT, ...overrides });
}

test('TC-040 happy path returns success', async () => {
  const { status, data } = await contact();
  assert.equal(status, 200);
  assert.equal(data.success, true);
});

test('TC-041 missing fullName → 400', async () => {
  const { status, data } = await contact({ fullName: '' });
  assert.equal(status, 400);
  assert.equal(data.success, false);
});

test('TC-041 missing email → 400', async () => {
  const { status, data } = await contact({ email: '' });
  assert.equal(status, 400);
  assert.equal(data.success, false);
});

test('TC-041 missing subject → 400', async () => {
  const { status, data } = await contact({ subject: '' });
  assert.equal(status, 400);
  assert.equal(data.success, false);
});

test('TC-041 missing message → 400', async () => {
  const { status, data } = await contact({ message: '' });
  assert.equal(status, 400);
  assert.equal(data.success, false);
});

test('TC-042 invalid email → 400', async () => {
  const { status, data } = await contact({ email: 'notvalid' });
  assert.equal(status, 400);
  assert.equal(data.success, false);
  assert.match(data.error, /email/i);
});

test('TC-043 honeypot filled → silent 200 (bot mitigation)', async () => {
  // Contact honeypot returns 200 silently to confuse bots
  const { status, data } = await contact({ _honey: 'bot-value' });
  assert.equal(status, 200);
  assert.equal(data.success, true);
});
