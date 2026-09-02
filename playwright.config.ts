import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

/**
 * The visual suite runs against its own server and its own database.
 *
 * Admin snapshots assert badge colour, and badge colour is chosen from row data,
 * so a shared database makes them a function of whatever `test:api` and the
 * functional specs happened to write. `.visual-data` is seeded from a fixed
 * dataset before the visual project runs and nothing else writes to it.
 */
export const VISUAL_PORT = 4322;
export const VISUAL_DATA_DIR = path.join(process.cwd(), '.visual-data');

const sharedEnv = {
  ...(process.env as Record<string, string>),
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'changeme',
  DISABLE_RATE_LIMIT: 'true',
  ALLOW_TEST_CONTENT: 'true',
};

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-reports/playwright-results',
  // Project name deliberately left out: these baselines are owned by the
  // `visual` project alone, and encoding the project into the filename means
  // renaming a project silently orphans 85 PNGs. Platform stays — font
  // rasterisation differs.
  snapshotPathTemplate: '{testDir}/{testFileName}-snapshots/{arg}-{platform}{ext}',
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
      // Functional specs. They write to the shared dev database, which is fine:
      // nothing they touch is snapshotted.
      name: 'chromium',
      testIgnore: ['visual.spec.ts', 'visual-seed.setup.ts'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'visual-seed',
      testMatch: 'visual-seed.setup.ts',
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${VISUAL_PORT}` },
    },
    {
      name: 'visual',
      testMatch: 'visual.spec.ts',
      dependencies: ['visual-seed'],
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${VISUAL_PORT}` },
    },
  ],
  webServer: [
    {
      command: 'npm run dev',
      url: 'http://localhost:4321',
      reuseExistingServer: true,
      timeout: 60_000,
      env: sharedEnv,
    },
    {
      command: `npx astro dev --port ${VISUAL_PORT}`,
      url: `http://localhost:${VISUAL_PORT}`,
      // Not reused: a server left over from a previous run may be pointed at a
      // different DATA_DIR, and the whole point here is knowing which database
      // is behind the snapshots.
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        ...sharedEnv,
        DATA_DIR: VISUAL_DATA_DIR,
        // Pins the calendar. Public routes derive card treatment and listing
        // order from whether a departure is still upcoming, so without this the
        // baselines expire on the next departure date — three of them fall in
        // the eighteen days after capture. The instant is the day the public
        // baselines were captured. See src/lib/clock.ts.
        TEST_NOW: '2026-09-02T12:00:00+05:30',
      },
    },
  ],
  workers: 1,
});
