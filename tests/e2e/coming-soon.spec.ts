import { test, expect } from '@playwright/test';

// qa-test-coming-soon has one bookable date (qa-cs-open-2099) and one
// coming-soon date (qa-cs-soon-2099).
const TRIP_URL = '/trips/qa-test-coming-soon/';

test('coming-soon date has no real price in the page HTML', async ({ page }) => {
  await page.goto(TRIP_URL);
  const html = await page.content();
  // The coming-soon offer price is 9000 — it must never be serialised anywhere.
  expect(html).not.toContain('9000');
  // JSON-LD Event for the coming-soon departure carries no offers block.
  // (BaseLayout emits an org-schema <script> first; the trip schema is separate.)
  const blocks = await page.locator('script[type="application/ld+json"]').allInnerTexts();
  const events = blocks
    .flatMap((raw) => {
      try { return (JSON.parse(raw)['@graph'] ?? []) as any[]; } catch { return []; }
    })
    .filter((n) => n['@type'] === 'Event');
  const csEvent = events.find((n) => String(n.startDate).startsWith('2099-06-01'));
  expect(csEvent).toBeTruthy();
  expect(csEvent.offers).toBeUndefined();
  const openEvent = events.find((n) => String(n.startDate).startsWith('2099-02-01'));
  expect(openEvent?.offers).toBeTruthy(); // the bookable date still advertises its price
});

test('selecting the coming-soon date switches the panel to wishlist mode', async ({ page }) => {
  await page.goto(TRIP_URL);
  await page.waitForSelector('[data-testid^="departure-"]', { timeout: 15_000 });

  // Bookable date → price + occupancy + Save my spot
  await page.locator('[data-testid="departure-qa-cs-open-2099"]').click();
  await expect(page.locator('#booking-panel-cta')).toBeVisible();

  // Coming-soon date → blurred price, wishlist form, no occupancy
  await page.locator('[data-testid="departure-qa-cs-soon-2099"]').click();
  await expect(page.locator('#wishlist-form')).toBeVisible();
  await expect(page.locator('#booking-panel-cta')).toHaveCount(0);
  await expect(page.locator('text=Choose occupancy')).toHaveCount(0);
});

test('signed-out visitor can submit the wishlist form and see confirmation', async ({ page }) => {
  await page.goto(TRIP_URL);
  await page.waitForSelector('[data-testid="departure-qa-cs-soon-2099"]', { timeout: 15_000 });
  await page.locator('[data-testid="departure-qa-cs-soon-2099"]').click();

  await page.locator('#wishlist-form input[type="text"]').fill('E2E Wishlister');
  await page.locator('#wishlist-form input[type="email"]').fill(`e2e-wl-${Date.now()}@example.invalid`);
  await page.locator('#wishlist-form input[type="tel"]').fill('+91 90000 12345');
  await page.locator('#wishlist-form button[type="submit"]').click();

  await expect(page.locator('[data-testid="wishlist-confirmation"]')).toBeVisible({ timeout: 10_000 });
});

test('guessed book URL for a coming-soon batch redirects back to the trip page', async ({ page }) => {
  const res = await page.goto('/trips/qa-test-coming-soon/book?batch=qa-cs-soon-2099');
  expect(page.url()).toContain('/trips/qa-test-coming-soon/');
  expect(page.url()).not.toContain('/book');
  expect(res?.status()).toBeLessThan(400);
});
