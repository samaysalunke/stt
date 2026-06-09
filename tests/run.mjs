// Test runner — starts a clean dev server with rate limiting disabled,
// runs the API test suite, then tears down.
//
// Usage:
//   node tests/run.mjs            # full suite (excludes rate-limits)
//   node tests/run.mjs --all      # includes rate-limits (requires fresh server)

import { spawn, execSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync, mkdirSync } from 'node:fs';

const PORT = 4399; // dedicated test port to avoid colliding with dev server
const BASE = `http://localhost:${PORT}`;
const TIMEOUT_MS = 30_000;

const includeRateLimits = process.argv.includes('--all');

const TEST_FILES = [
  'tests/api/register.test.mjs',
  'tests/api/register-v2.test.mjs',
  'tests/api/registration-status.test.mjs',
  'tests/api/contact.test.mjs',
  'tests/api/newsletter.test.mjs',
  'tests/api/auth.test.mjs',
  'tests/api/security.test.mjs',
  'tests/api/admin-trips.test.mjs',
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
