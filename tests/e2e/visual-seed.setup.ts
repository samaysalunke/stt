import { test as setup, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { VISUAL_DATA_DIR } from '../../playwright.config';

/**
 * Runs before the `visual` project, against the visual server only.
 *
 * Two steps, and the order matters: `src/lib/db.ts` creates the schema lazily on
 * the first `getDb()`, so a freshly-created `.visual-data` has no tables until
 * something requests a page. The seed script refuses to invent the DDL itself,
 * so it has to be poked first.
 */
setup('seed the visual database', async ({ request }) => {
  const resp = await request.get('/');
  expect(resp.ok(), 'visual dev server reachable').toBeTruthy();

  execFileSync(process.execPath, ['scripts/seed-visual-db.mjs'], {
    env: { ...process.env, DATA_DIR: VISUAL_DATA_DIR },
    stdio: 'inherit',
  });
});
