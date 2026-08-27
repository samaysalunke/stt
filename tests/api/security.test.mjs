// TC-190 to TC-195 — Security
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiPost, apiGet, adminLogin, VALID_REG, BASE } from './helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const DB_PATH = path.resolve(__dirname, '../../data/seekthethrill.db');

test('TC-190 unauthenticated /admin/* access → redirect (middleware guards all admin routes)', async () => {
  const routes = ['/admin/trips', '/admin/registrations', '/admin/contacts', '/admin/newsletter'];
  for (const route of routes) {
    const res = await fetch(`${BASE}${route}`, { redirect: 'manual' });
    assert.ok(res.status >= 300 && res.status < 400, `${route} should redirect, got ${res.status}`);
    assert.match(res.headers.get('location') ?? '', /\/admin\/login/, `${route} should redirect to login`);
  }
});

test('TC-191 unauthenticated /api/admin/* → redirect (not 200)', async () => {
  const endpoints = [
    { method: 'POST', path: '/api/admin/trips/create' },
    { method: 'POST', path: '/api/admin/trips/delete' },
    { method: 'POST', path: '/api/admin/albums/create' },
    { method: 'GET',  path: '/api/admin/export' },
  ];
  for (const { method, path: p } of endpoints) {
    const res = await fetch(`${BASE}${p}`, {
      method,
      body: method === 'POST' ? new FormData() : undefined,
      redirect: 'manual',
    });
    assert.ok(res.status >= 300 && res.status < 400, `${method} ${p} should redirect, got ${res.status}`);
  }
});

test('TC-192 XSS payload in registration is accepted by API (escaping is at render time)', async () => {
  // sanitizeInput only trims/slices — HTML is escaped by Astro JSX at render
  const xssPayload = '<script>alert("xss")</script>';
  const { status, data } = await apiPost('/api/register', {
    ...VALID_REG,
    email: 'qa-xss@example.invalid',
    fullName: xssPayload,
  });
  // API should accept it (escaping is a render concern, not input concern)
  assert.equal(status, 200);
  assert.equal(data.success, true);
});

test('TC-193 SQL injection payload is stored safely via prepared statements', async () => {
  const sqlPayload = "'; DROP TABLE registrations; --";
  const { status, data } = await apiPost('/api/register', {
    ...VALID_REG,
    email: 'qa-sqli@example.invalid',
    fullName: sqlPayload,
    whyJoin: sqlPayload,
  });
  assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`);
  assert.equal(data.success, true);

  // Verify DB is intact by querying it directly
  const Database = require('better-sqlite3');
  const db = new Database(DB_PATH, { readonly: true });
  const row = db.prepare("SELECT full_name FROM registrations WHERE email = 'qa-sqli@example.invalid'").get();
  db.close();
  assert.ok(row, 'Row should exist in registrations table (table not dropped)');
  assert.equal(row.full_name, sqlPayload, 'Payload should be stored verbatim (not executed)');
});

test('TC-194 admin_token cookie value is a session UUID (not the plain password)', async () => {
  const { cookie } = await adminLogin('changeme');
  const tokenMatch = cookie.match(/admin_token=([^;]+)/);
  assert.ok(tokenMatch, 'Cookie should contain admin_token');
  const token = tokenMatch[1];
  assert.notEqual(token, 'changeme', 'Token must not be the plain password');
  // Session tokens are UUIDs: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  assert.match(token, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, 'Token should be a UUID');
});

test('TC-195 Set-Cookie header has httpOnly flag', async () => {
  const { setCookie } = await adminLogin('changeme');
  assert.ok(setCookie, 'Should have Set-Cookie header');
  assert.ok(
    setCookie.toLowerCase().includes('httponly'),
    `Expected httpOnly in Set-Cookie, got: ${setCookie}`
  );
});

function testUploadForm() {
  const fd = new FormData();
  fd.append('file', new Blob(['fake png'], { type: 'image/png' }), 'payment.png');
  return fd;
}

test('TC-196 same-origin multipart upload is allowed', async () => {
  const res = await fetch(`${BASE}/api/upload`, {
    method: 'POST',
    headers: { Origin: BASE },
    body: testUploadForm(),
  });
  const data = await res.json();

  assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(data)}`);
  assert.equal(data.success, true);
  assert.match(data.url, /^\/api\/uploads\/.+\.png$/);
});

test('TC-197 cross-origin multipart upload is rejected', async () => {
  const res = await fetch(`${BASE}/api/upload`, {
    method: 'POST',
    headers: { Origin: 'https://evil.example' },
    body: testUploadForm(),
  });
  const text = await res.text();

  assert.equal(res.status, 403);
  assert.match(text, /Cross-site POST form submissions are forbidden/);
});

test('TC-198 forwarded same-origin multipart upload is allowed', async () => {
  const res = await fetch(`${BASE}/api/upload`, {
    method: 'POST',
    headers: {
      Origin: 'https://stt-production-2707.up.railway.app',
      'X-Forwarded-Proto': 'https',
      'X-Forwarded-Host': 'stt-production-2707.up.railway.app',
    },
    body: testUploadForm(),
  });
  const data = await res.json();

  assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(data)}`);
  assert.equal(data.success, true);
});

test('TC-199 Zoho document worker rejects requests without its bearer secret', async () => {
  const res = await fetch(`${BASE}/api/jobs/zoho-documents`, { method: 'POST' });
  assert.equal(res.status, 401);
});
