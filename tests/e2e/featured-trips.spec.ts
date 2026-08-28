import { test, expect } from '@playwright/test';

for (const width of [320, 375, 390]) {
  test(`trip cards stack cleanly at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });

    for (const path of ['/', '/trips/']) {
      await page.goto(path);

      const cards = page.locator('[data-testid="trip-card"]');
      expect(await cards.count()).toBeGreaterThan(0);

      for (const card of await cards.all()) {
        await expect(card).toBeVisible();
        const cardBox = await card.boundingBox();
        expect(cardBox?.width ?? 0).toBeGreaterThan(0);
        await expect(card.locator('[data-testid="trip-card-summary"]')).toHaveCSS('flex-direction', 'column');
        const info = await card.locator('[data-testid="trip-card-info"]').boundingBox();
        const price = await card.locator('[data-testid="trip-card-price"]').boundingBox();
        expect(info).not.toBeNull();
        expect(price).not.toBeNull();
        expect((price?.y ?? 0)).toBeGreaterThanOrEqual((info?.y ?? 0) + (info?.height ?? 0));
      }

      const pageWidth = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      expect(pageWidth.scroll).toBeLessThanOrEqual(pageWidth.client);
    }
  });
}

test('wide listing cards retain the two-column summary', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/trips/');

  const summary = page.locator('[data-testid="trip-card-summary"]').first();
  await expect(summary).toHaveCSS('flex-direction', 'row');
});

test('desktop featured trip cards fill their carousel slots', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');

  const slots = page.locator('#featured-carousel > div');
  expect(await slots.count()).toBeGreaterThan(0);

  for (const slot of await slots.all()) {
    const card = slot.locator('[data-testid="trip-card"]');
    await expect(card).toBeVisible();
    const [slotBox, cardBox] = await Promise.all([slot.boundingBox(), card.boundingBox()]);
    expect(slotBox).not.toBeNull();
    expect(cardBox).not.toBeNull();
    expect(Math.abs((slotBox?.width ?? 0) - (cardBox?.width ?? 0))).toBeLessThan(1);
  }
});

test('mobile featured trip cards share one height', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  const cards = page.locator('#featured-carousel [data-testid="trip-card"]');
  const count = await cards.count();
  expect(count).toBeGreaterThan(1);

  const heights = await cards.evaluateAll((items) =>
    items.map((item) => item.getBoundingClientRect().height),
  );
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(1);
});
