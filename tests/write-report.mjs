// Merges unit + API + Playwright results into test-reports/report.md
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const now = new Date().toISOString();
const lines = [`# Test Report`, ``, `Generated: ${now}`, ``];

// ── Unit tests (Vitest JSON) ──────────────────────────────────────────────────
lines.push('## Unit Tests (Vitest)');
try {
  const raw = JSON.parse(readFileSync('test-reports/unit.json', 'utf-8'));
  const numFiles = raw.testResults?.length ?? 0;
  const passed = raw.numPassedTests ?? 0;
  const failed = raw.numFailedTests ?? 0;
  const status = failed === 0 ? '✅ PASSED' : '❌ FAILED';
  lines.push(``, `**${status}** — ${passed} passed, ${failed} failed across ${numFiles} file(s)`);
  if (failed > 0) {
    lines.push(``, `### Failures`);
    for (const file of (raw.testResults ?? [])) {
      for (const result of (file.assertionResults ?? [])) {
        if (result.status === 'failed') {
          lines.push(`- \`${result.ancestorTitles.join(' > ')} > ${result.title}\``);
          if (result.failureMessages?.[0]) {
            lines.push(`  \`\`\``, `  ${result.failureMessages[0].split('\n')[0]}`, `  \`\`\``);
          }
        }
      }
    }
  }
} catch {
  lines.push(``, `_No unit report found. Run \`npm run test:unit\` first._`);
}

// ── API tests ─────────────────────────────────────────────────────────────────
lines.push(``, `## API Tests (node:test)`);
try {
  const report = readFileSync('test-reports/api-report.md', 'utf-8');
  const statusLine = report.match(/\*\*.*\*\*/)?.[0] ?? '_unknown_';
  lines.push(``, statusLine);
} catch {
  lines.push(``, `_No API report found. Run \`npm run test:api\` first._`);
}

// ── Playwright ────────────────────────────────────────────────────────────────
lines.push(``, `## E2E Tests (Playwright)`);
const pwReport = 'test-reports/playwright/index.html';
if (existsSync(pwReport)) {
  lines.push(``, `Report available at: \`test-reports/playwright/index.html\``);
} else {
  lines.push(``, `_No Playwright report found. Run \`npm run test:e2e\` first._`);
}

lines.push('');
const output = lines.join('\n');
writeFileSync('test-reports/report.md', output, 'utf-8');
console.log('\n' + output);
console.log('Report written to test-reports/report.md');
