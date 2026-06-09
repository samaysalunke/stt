import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-reports/playwright-results',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'test-reports/playwright', open: 'never' }],
  ],
  use: {
    baseURL: 'http://localhost:4321',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:4321',
    reuseExistingServer: true,
    timeout: 60_000,
    env: { ...(process.env as Record<string, string>), DISABLE_RATE_LIMIT: 'true' },
  },
  workers: 1,
});
