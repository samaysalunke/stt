// TC-030 to TC-037 — POST /api/register
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiPost, VALID_REG } from './helpers.mjs';

async function reg(overrides = {}) {
  return apiPost('/api/register', { ...VALID_REG, ...overrides });
}

test('TC-030 happy path returns success', async () => {
  const { status, data } = await reg();
  assert.equal(status, 200);
  assert.equal(data.success, true);
});

test('TC-031 missing fullName → 400 with field name in error', async () => {
  const { status, data } = await reg({ fullName: '' });
  assert.equal(status, 400);
  assert.equal(data.success, false);
  assert.match(data.error, /fullName/);
});

test('TC-031 missing email → 400', async () => {
  const { status, data } = await reg({ email: '' });
  assert.equal(status, 400);
  assert.equal(data.success, false);
  assert.match(data.error, /email/i);
});

test('TC-031 missing phone → 400', async () => {
  const { status, data } = await reg({ phone: '' });
  assert.equal(status, 400);
  assert.equal(data.success, false);
  assert.match(data.error, /phone/i);
});

test('TC-031 missing city → 400', async () => {
  const { status, data } = await reg({ city: '' });
  assert.equal(status, 400);
  assert.equal(data.success, false);
  assert.match(data.error, /city/i);
});

test('TC-031 missing emergencyName → 400', async () => {
  const { status, data } = await reg({ emergencyName: '' });
  assert.equal(status, 400);
  assert.equal(data.success, false);
  assert.match(data.error, /emergencyName/i);
});

test('TC-031 missing emergencyPhone → 400', async () => {
  const { status, data } = await reg({ emergencyPhone: '' });
  assert.equal(status, 400);
  assert.equal(data.success, false);
  assert.match(data.error, /emergencyPhone/i);
});

test('TC-031 missing whyJoin → 400', async () => {
  const { status, data } = await reg({ whyJoin: '' });
  assert.equal(status, 400);
  assert.equal(data.success, false);
  assert.match(data.error, /whyJoin/i);
});

test('TC-032 invalid email format → 400', async () => {
  const { status, data } = await reg({ email: 'notanemail' });
  assert.equal(status, 400);
  assert.equal(data.success, false);
  assert.match(data.error, /email/i);
});

test('TC-032 email missing domain → 400', async () => {
  const { status, data } = await reg({ email: 'user@' });
  assert.equal(status, 400);
  assert.equal(data.success, false);
});

test('TC-033 invalid phone (letters) → 400', async () => {
  const { status, data } = await reg({ phone: 'abcdefghij' });
  assert.equal(status, 400);
  assert.equal(data.success, false);
  assert.match(data.error, /phone/i);
});

test('TC-033 phone too short (5 digits) → 400', async () => {
  const { status, data } = await reg({ phone: '12345' });
  assert.equal(status, 400);
  assert.equal(data.success, false);
});

test('TC-034 sold-out trip → 400', async () => {
  const { status, data } = await reg({
    tripSlug: 'qa-test-sold-out',
    tripName: 'QA Test — Sold Out Trip',
  });
  assert.equal(status, 400);
  assert.equal(data.success, false);
  assert.match(data.error, /sold.?out/i);
});

test('TC-035 honeypot field filled → 400', async () => {
  const { status, data } = await reg({ _honey: 'bot-fill' });
  assert.equal(status, 400);
  assert.equal(data.success, false);
});

test('TC-037 successful submission stores record (verify via 200 + success flag)', async () => {
  const { status, data } = await reg({ email: 'qa-verify-store@example.invalid' });
  assert.equal(status, 200);
  assert.equal(data.success, true);
  // Full DB row check is covered in Phase 2 (admin registrations page)
});
