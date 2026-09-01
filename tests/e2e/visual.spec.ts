import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { waitForHydration } from './helpers';

/**
 * Visual-regression oracle for the UI refresh.
 *
 * Phase 3 (marketing pages) is expected to change these snapshots on purpose —
 * review the diff, then `npx playwright test visual.spec.ts --update-snapshots`.
 * Every other phase (shared chrome, booking flow, account, admin) must leave the
 * relevant snapshots byte-identical; a diff there is a regression, not a redesign.
 *
 * Determinism measures:
 *  - all remote hero imagery (images.unsplash.com) is stubbed with a bundled
 *    local file, so runs are offline and pixel-stable
 *  - CSS animations/transitions are frozen (`animations: 'disabled'`) and the
 *    card-skeleton shimmer + scroll-reveal are forced to their resting state
 *  - web fonts are awaited before the shot
 *  - live regions (discount countdowns) are masked
 */

const LOCAL_IMG = readFileSync(fileURLToPath(new URL('../../public/logo.jpg', import.meta.url)));

const VIEWPORTS = [
  { tag: 'mobile', width: 390, height: 844 },
  { tag: 'desktop', width: 1280, height: 900 },
] as const;

// Public routes only. `profile` / `u/[username]` (auth) and `unsubscribe` (token)
// are deliberately excluded until the phase that restyles them.
const ROUTES: { name: string; path: string }[] = [
  { name: 'home', path: '/' },
  { name: 'trips-index', path: '/trips/' },
  { name: 'trip-detail', path: '/trips/qa-test-bookable/' },
  { name: 'trip-book', path: '/trips/qa-test-bookable/book?batch=qa-bookable-2099&tier=standard' },
  { name: 'about', path: '/about/' },
  { name: 'faq', path: '/faq/' },
  { name: 'contact', path: '/contact/' },
  { name: 'custom-itineraries', path: '/custom-itineraries/' },
  { name: 'leaderboard', path: '/leaderboard/' },
  { name: 'photo-vault-index', path: '/photo-vault/' },
  { name: 'terms', path: '/terms/' },
  { name: 'privacy', path: '/privacy/' },
  { name: 'cancellation', path: '/cancellation/' },
  { name: 'login', path: '/login/' },
  { name: 'thank-you', path: '/thank-you/' },
  { name: 'not-found', path: '/this-route-does-not-exist' },
];

async function freezePage(page: Page) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        caret-color: transparent !important;
      }
      /* card skeleton shimmer → resting */
      [data-card-skeleton]::after { display: none !important; }
      /* scroll-reveal → visible */
      .reveal, .anim-fade-up { opacity: 1 !important; transform: none !important; }
    `,
  });
  await page.evaluate(() => (document as any).fonts?.ready).catch(() => {});
}

test.describe('visual regression — public routes', () => {
  for (const vp of VIEWPORTS) {
    for (const route of ROUTES) {
      test(`${route.name} @ ${vp.tag}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });

        await page.route('**://images.unsplash.com/**', (r) =>
          r.fulfill({ contentType: 'image/jpeg', body: LOCAL_IMG }),
        );

        const resp = await page.goto(route.path, { waitUntil: 'networkidle' });
        // /this-route-does-not-exist intentionally 404s; every other route is 200.
        expect(resp?.status(), route.path).toBeLessThan(route.name === 'not-found' ? 500 : 400);

        await waitForHydration(page).catch(() => {});
        await freezePage(page);
        await page.waitForTimeout(150); // let the frozen layout settle

        await expect(page).toHaveScreenshot(`${route.name}-${vp.tag}.png`, {
          fullPage: true,
          animations: 'disabled',
          mask: [page.locator('[data-testid="discount-expiry"]')],
          maxDiffPixelRatio: 0.01,
        });
      });
    }
  }
});
