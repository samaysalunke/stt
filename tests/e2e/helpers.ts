import { expect, type Page, type Locator } from '@playwright/test';

/**
 * Wait until every Astro island on the page has hydrated.
 *
 * Islands are server-rendered, so their markup — buttons included — is present
 * and "actionable" to Playwright well before the framework JS has attached any
 * handlers. Clicking in that window silently does nothing, which is why
 * `goto()` immediately followed by `click()` fails intermittently on the
 * booking flow, the departure picker and the admin editors.
 *
 * Astro marks a not-yet-hydrated island with an `ssr` attribute on its
 * `<astro-island>` wrapper and removes it once hydration completes, so that
 * attribute is an exact readiness signal — no arbitrary timeouts, no
 * retry-clicking (which risks double submits on forms).
 */
export async function waitForHydration(page: Page, timeout = 15_000) {
  const islands = page.locator('astro-island');
  const count = await islands.count();
  for (let i = 0; i < count; i++) {
    await expect(islands.nth(i)).not.toHaveAttribute('ssr', /.*/, { timeout });
  }
}

/** `page.goto()` that only resolves once the page's islands are interactive. */
export async function gotoHydrated(page: Page, url: string, timeout = 15_000) {
  await page.goto(url);
  await waitForHydration(page, timeout);
}

/** Click a control that lives inside an island, once that island can respond. */
export async function clickHydrated(page: Page, target: Locator | string, timeout = 15_000) {
  await waitForHydration(page, timeout);
  const locator = typeof target === 'string' ? page.locator(target) : target;
  await locator.click();
}
