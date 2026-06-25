// Live analytics LLM smoke runner.
// Requires real ANALYTICS_LLM_* env vars and runs only the live analytics API test.

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const required = ['ANALYTICS_LLM_PROVIDER', 'ANALYTICS_LLM_MODEL', 'ANALYTICS_LLM_API_KEY'];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Missing required env vars: ${missing.join(', ')}`);
  process.exit(1);
}

const PORT = Number(process.env.ANALYTICS_LIVE_PORT || 4401);
const BASE = `http://localhost:${PORT}`;
const TIMEOUT_MS = 30_000;

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (res.status > 0) return true;
    } catch {}
    await sleep(500);
  }
  throw new Error(`Server at ${url} did not start within ${timeoutMs}ms`);
}

process.env.TEST_BASE_URL = BASE;

const server = spawn('node_modules/.bin/astro', ['dev', '--port', String(PORT)], {
  env: {
    ...process.env,
    DISABLE_RATE_LIMIT: 'true',
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'changeme',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

server.stderr.on('data', d => process.stderr.write(d));

let exitCode = 1;
try {
  console.log(`\nStarting live analytics test server on port ${PORT}...`);
  await waitForServer(`${BASE}/`, TIMEOUT_MS);
  console.log('Server ready. Running live analytics LLM smoke test...\n');

  const runner = spawn(
    process.execPath,
    ['--test', '--test-reporter=spec', '--test-concurrency=1', 'tests/api/analytics-live.test.mjs'],
    {
      env: { ...process.env, TEST_BASE_URL: BASE },
      stdio: 'inherit',
    },
  );

  exitCode = await new Promise(resolve => runner.on('close', resolve));
} catch (err) {
  console.error('\nLive analytics test runner error:', err.message);
} finally {
  server.kill('SIGTERM');
}

process.exit(exitCode);
