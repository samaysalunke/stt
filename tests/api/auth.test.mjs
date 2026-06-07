// TC-070 to TC-075 — Admin authentication
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adminLogin, apiGet, BASE } from './helpers.mjs';

test('TC-070 correct password sets cookie and redirects to the admin dashboard', async () => {
  const { cookie, location, status } = await adminLogin('changeme');
  // Middleware redirects → Astro returns 302/303
  assert.ok(status >= 300 && status < 400, `Expected redirect, got ${status}`);
  assert.match(location, /\/admin\/?($|\?)/);
  assert.match(cookie, /admin_token=\S+/);
});

test('TC-071 wrong password redirects to /admin/login?error=1', async () => {
  const { location, status } = await adminLogin('wrongpassword');
  assert.ok(status >= 300 && status < 400);
  assert.match(location, /\/admin\/login\?error=1/);
});

test('TC-072 empty password redirects to error', async () => {
  const { location, status } = await adminLogin('');
  assert.ok(status >= 300 && status < 400);
  assert.match(location, /\/admin\/login/);
});

test('TC-074 unauthenticated GET /admin/trips redirects to login', async () => {
  const { status, headers } = await apiGet('/admin/trips', { redirect: 'manual' });
  assert.ok(status >= 300 && status < 400, `Expected redirect, got ${status}`);
  const location = headers.get('location') ?? '';
  assert.match(location, /\/admin\/login/);
});

test('TC-074 unauthenticated POST /api/admin/trips/create redirects to login', async () => {
  const res = await fetch(`${BASE}/api/admin/trips/create`, {
    method: 'POST',
    body: new FormData(),
    redirect: 'manual',
  });
  assert.ok(res.status >= 300 && res.status < 400, `Expected redirect, got ${res.status}`);
  assert.match(res.headers.get('location') ?? '', /\/admin\/login/);
});

test('TC-075 logout clears cookie', async () => {
  // Login first
  const { cookie } = await adminLogin('changeme');
  assert.ok(cookie, 'Should have a cookie after login');

  // Logout
  const res = await fetch(`${BASE}/api/admin/logout`, {
    method: 'POST',
    headers: { cookie },
    redirect: 'manual',
  });
  const setCookie = res.headers.get('set-cookie') ?? '';
  // Cookie should be expired/cleared (max-age=0 or expires in past)
  assert.ok(
    setCookie.includes('Max-Age=0') ||
    setCookie.includes('max-age=0') ||
    setCookie.includes('admin_token=;') ||
    setCookie.includes('Expires='),
    `Expected cookie to be cleared, got: ${setCookie}`
  );
});
