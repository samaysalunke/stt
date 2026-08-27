import { test, expect } from '@playwright/test';

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
