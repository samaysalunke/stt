import { expect, test } from '@playwright/test';

test.describe('trip description', () => {
  for (const width of [320, 375, 390]) {
    test(`expands without horizontal overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 780 });
      await page.goto('/trips/monsoon-meghalaya/');

      const content = page.locator('[data-trip-feels-text]');
      const toggle = page.locator('[data-trip-feels-toggle]');
      await expect(content.locator('.rich-text')).toBeVisible();
      await expect(toggle).toBeVisible();
      await expect(toggle).toHaveText('Read more');

      const collapsedHeight = await content.evaluate((element) => element.clientHeight);
      await toggle.click();
      await expect(toggle).toHaveText('Show less');
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect(await content.evaluate((element) => element.clientHeight)).toBeGreaterThan(collapsedHeight);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

      await toggle.click();
      await expect(toggle).toHaveText('Read more');
      await expect(content).toHaveClass(/trip-description-collapsed/);
    });
  }
});
