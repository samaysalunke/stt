// TC-036, TC-073 — Rate limiting
//
// IMPORTANT: Run on a freshly started dev server.
// The rate limiter is in-memory; running other test files first may exhaust
// the budget and cause false failures here.
//
//   npm run dev   # fresh server
//   node --test --test-reporter=spec tests/api/rate-limits.test.mjs
//
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiPost, adminLogin, VALID_REG } from './helpers.mjs';

// TC-036: /api/register allows 5 per IP per hour
test('TC-036 registration rate limit: 6th request from same IP → 429', async () => {
  // Send 5 valid requests (each with a unique email to avoid DB constraints)
  for (let i = 0; i < 5; i++) {
    const { status } = await apiPost('/api/register', {
      ...VALID_REG,
      email: `qa-ratelimit-reg-${i}@example.invalid`,
    });
    assert.equal(status, 200, `Request ${i + 1}/5 should succeed, got ${status}`);
  }
  // 6th must be rate-limited
  const { status, data } = await apiPost('/api/register', {
    ...VALID_REG,
    email: 'qa-ratelimit-reg-6@example.invalid',
  });
  assert.equal(status, 429, `6th request should be rate-limited (429), got ${status}`);
  assert.equal(data.success, false);
  assert.match(data.error, /too many/i);
});

// TC-073: /api/admin/login allows 10 per IP per hour (separate key: login:<ip>)
test('TC-073 login rate limit: 11th attempt → error even with correct password', async () => {
  // Send 10 wrong-password attempts to fill the bucket
  for (let i = 0; i < 10; i++) {
    const { location } = await adminLogin('wrongpassword');
    assert.match(location, /\/admin\/login/, `Attempt ${i + 1}/10 should redirect to login`);
  }
  // 11th attempt with CORRECT password should be rate-limited (redirects to error, not registrations)
  const { location } = await adminLogin('changeme');
  assert.match(
    location,
    /\/admin\/login/,
    `11th attempt should be blocked by rate limit even with correct password, got: ${location}`
  );
});
