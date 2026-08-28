import { test, expect } from '@playwright/test';

const fallbackImage = '**/photo-1464822759023-fed622ff2c3b*';

test('an uncached card reveals on pointer interaction and never blocks the link', async ({ page }) => {
  await page.route(fallbackImage, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    await route.abort();
  });
  await page.goto('/trips/', { waitUntil: 'domcontentloaded' });
  const card = page.locator('[data-testid="trip-card"]').first();
  await expect(card).not.toHaveAttribute('data-skeleton-ready', '');
  await card.dispatchEvent('pointerdown');
  await expect(card).toHaveAttribute('data-skeleton-ready', '');
  await expect(card.locator('a').first()).toBeEnabled();
});

test('failed images and the 2.5 second fail-safe both reveal cards', async ({ page }) => {
  await page.route(fallbackImage, (route) => route.abort());
  await page.goto('/trips/');
  await expect(page.locator('[data-testid="trip-card"]').first()).toHaveAttribute('data-skeleton-ready', '');

  await page.unroute(fallbackImage);
  await page.route(fallbackImage, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    await route.abort();
  });
  await page.goto('/trips/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-testid="trip-card"]').first()).toHaveAttribute('data-skeleton-ready', '', { timeout: 3_500 });
});

test('reduced motion keeps the loading overlay static', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.route(fallbackImage, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    await route.abort();
  });
  await page.goto('/trips/', { waitUntil: 'domcontentloaded' });
  const animation = await page.locator('[data-testid="trip-card"]').first().evaluate((card) =>
    getComputedStyle(card, '::after').animationName,
  );
  expect(animation).toBe('none');
  await context.close();
});

test('cards remain visible when JavaScript is disabled', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/trips/');
  const card = page.locator('[data-testid="trip-card"]').first();
  await expect(card).toBeVisible();
  await expect(card.locator('h3')).toBeVisible();
  await expect(page.locator('html')).not.toHaveClass(/card-skeletons-active/);
  await context.close();
});
