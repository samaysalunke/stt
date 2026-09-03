// Test runner — starts a clean dev server with rate limiting disabled,
// runs the API test suite, then tears down.
//
// Usage:
//   node tests/run.mjs            # full suite (excludes rate-limits)
//   node tests/run.mjs --all      # includes rate-limits (requires fresh server)
//
// Seeded rows are purged from the dev database after the run. Set
// KEEP_TEST_DATA=1 to keep them for inspection after a failure.

import { spawn, execSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const DB_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/seekthethrill.db');

/**
 * Delete everything the suite seeded, once, after the whole run.
 *
 * `/api/test/cleanup` only reaches rows carrying a batch_id + tier_id, so the
 * fixtures seeded straight into the DB — public-profile's "Test Trip" and
 * PUBLIC_TRIP_* rows, the analytics trips — survived every run and accumulated.
 * A dev database that had drifted to ~1000 rows is not just untidy: it made the
 * admin pages unreadable and, once, sent a real investigation chasing states
 * that existed only in test residue.
 *
 * Scoped to the `@example.invalid` reserved TLD (RFC 2606), which can never be
 * a real address, so a developer's own manual rows are never touched. Runs
 * after the suite rather than per-file so no file's teardown can delete a
 * fixture another file is still using — the runner is serial, but the ordering
 * guarantee is worth keeping explicit.
 */
function purgeTestArtifacts() {
  let db;
  try {
    db = require('better-sqlite3')(DB_PATH);
  } catch {
    return null; // No database yet (fresh checkout) — nothing to purge.
  }
  try {
    const before = db.prepare('SELECT COUNT(*) n FROM registrations').get().n;
    db.transaction(() => {
      db.prepare("DELETE FROM payment_events WHERE registration_id IN (SELECT id FROM registrations WHERE email LIKE '%@example.invalid')").run();
      db.prepare("DELETE FROM invoice_documents WHERE registration_id IN (SELECT id FROM registrations WHERE email LIKE '%@example.invalid')").run();
      db.prepare("DELETE FROM telegram_notification_events WHERE registration_id IN (SELECT id FROM registrations WHERE email LIKE '%@example.invalid')").run();
      db.prepare("DELETE FROM registrations WHERE email LIKE '%@example.invalid'").run();
      db.prepare("DELETE FROM user_sessions WHERE userId IN (SELECT id FROM users WHERE email LIKE '%@example.invalid')").run();
      db.prepare("DELETE FROM leaderboard_cache WHERE email LIKE '%@example.invalid'").run();
      db.prepare("DELETE FROM users WHERE email LIKE '%@example.invalid'").run();
      db.prepare("DELETE FROM email_delivery_log WHERE recipient LIKE '%@example.invalid'").run();
      // `/api/test/cleanup` deletes registrations without their dependent rows,
      // so orphans have been accruing for as long as it has existed. Sweep any
      // row pointing at a registration that is gone, whoever deleted it.
      db.prepare('DELETE FROM payment_events WHERE registration_id NOT IN (SELECT id FROM registrations)').run();
      db.prepare('DELETE FROM invoice_documents WHERE registration_id NOT IN (SELECT id FROM registrations)').run();
      db.prepare('DELETE FROM telegram_notification_events WHERE registration_id NOT IN (SELECT id FROM registrations)').run();
      db.prepare('DELETE FROM user_sessions WHERE userId NOT IN (SELECT id FROM users)').run();
    })();
    const after = db.prepare('SELECT COUNT(*) n FROM registrations').get().n;
    return { removed: before - after, remaining: after };
  } catch (err) {
    console.error('[cleanup] purge failed:', err.message);
    return null;
  } finally {
    db.close();
  }
}

const PORT = 4399; // dedicated test port to avoid colliding with dev server
const BASE = `http://localhost:${PORT}`;
const TIMEOUT_MS = 30_000;

const includeRateLimits = process.argv.includes('--all');

const TEST_FILES = [
  'tests/api/register.test.mjs',
  'tests/api/register-v2.test.mjs',
  'tests/api/registration-status.test.mjs',
  'tests/api/registration-refund.test.mjs',
  'tests/api/wishlist.test.mjs',
  'tests/api/admin-registrations.test.mjs',
  'tests/api/occupancy-change.test.mjs',
  'tests/api/telegram-notifications.test.mjs',
  'tests/api/newsletter.test.mjs',
  'tests/api/auth.test.mjs',
  'tests/api/security.test.mjs',
  'tests/api/rbac.test.mjs',
  'tests/api/analytics.test.mjs',
  'tests/api/gamification.test.mjs',
  'tests/api/public-profile.test.mjs',
  'tests/api/admin-trips.test.mjs',
  'tests/api/admin-faqs.test.mjs',
  ...(includeRateLimits ? ['tests/api/rate-limits.test.mjs'] : []),
];

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (res.status > 0) return true;
    } catch { /* not ready yet */ }
    await sleep(500);
  }
  throw new Error(`Server at ${url} did not start within ${timeoutMs}ms`);
}

// Inject the test port into helpers so tests use the right server
process.env.TEST_BASE_URL = BASE;

const server = spawn('node_modules/.bin/astro', ['dev', '--port', String(PORT)], {
  env: {
    ...process.env,
    DISABLE_RATE_LIMIT: 'true',
    ADMIN_PASSWORD: 'changeme',
    ANALYTICS_LLM_PROVIDER: 'test',
    ANALYTICS_LLM_MODEL: 'test-model',
    ANALYTICS_LLM_API_KEY: 'test-key',
    ANALYTICS_LLM_FAKE_RESPONSE: 'Fake LLM analytics answer streamed from the test adapter.',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

server.stderr.on('data', d => process.stderr.write(d));

let exitCode = 1;

try {
  console.log(`\nStarting test server on port ${PORT}…`);
  await waitForServer(`${BASE}/`, TIMEOUT_MS);
  console.log('Server ready. Running API tests…\n');

  const runner = spawn(
    process.execPath,
    ['--test', '--test-reporter=spec', '--test-concurrency=1', ...TEST_FILES],
    {
      env: { ...process.env, TEST_BASE_URL: BASE },
      stdio: 'inherit',
    }
  );

  exitCode = await new Promise(resolve => runner.on('close', resolve));

  // Purge regardless of pass or fail — a failed run leaves the most residue.
  // A failure is also when you might want the rows to inspect, so KEEP_TEST_DATA=1
  // holds them; the next clean run sweeps them anyway.
  if (process.env.KEEP_TEST_DATA === '1') {
    console.log('\n[cleanup] skipped (KEEP_TEST_DATA=1) — seeded rows left in place.');
  } else {
    const purged = purgeTestArtifacts();
    if (purged) {
      console.log(`\n[cleanup] removed ${purged.removed} test registration(s); ${purged.remaining} row(s) remain.`);
    }
  }

  // Write a minimal API report to test-reports/api-report.md
  try {
    mkdirSync('test-reports', { recursive: true });
    const status = exitCode === 0 ? '✅ PASSED' : '❌ FAILED';
    const lines = [
      `# API Test Report`,
      ``,
      `**${status}**`,
      ``,
      `Generated: ${new Date().toISOString()}`,
      `Exit code: ${exitCode}`,
      '',
    ];
    writeFileSync('test-reports/api-report.md', lines.join('\n'), 'utf-8');
  } catch { /* non-fatal */ }
} catch (err) {
  console.error('\nTest runner error:', err.message);
} finally {
  server.kill('SIGTERM');
}

process.exit(exitCode);
