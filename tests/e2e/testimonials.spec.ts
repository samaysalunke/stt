import { expect, test } from '@playwright/test';
import { listTestimonials, selectFeaturedTestimonials } from '../../src/lib/content';

const testimonials = listTestimonials();
const expectedNames = testimonials.map(testimonial => testimonial.name);

test.describe('global testimonials', () => {
  for (const slug of ['monsoon-meghalaya', 'eastern-frontier-arunachal', 'qa-test-sold-out']) {
    test(`shows every testimonial in source order on ${slug}`, async ({ page }) => {
      await page.goto(`/trips/${slug}/`);

      const cards = page.locator('expandable-testimonial');
      await expect(cards).toHaveCount(testimonials.length);
      await expect(cards.locator('figcaption p:first-child')).toHaveText(expectedNames);
    });
  }

  test('expands one compact card without stretching its neighbor', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/trips/monsoon-meghalaya/');

    const cards = page.locator('expandable-testimonial');
    const expandedCard = cards.first();
    const toggle = expandedCard.locator('.testimonial-toggle');
    const neighbor = cards.nth(1);
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveText('Read more');
    const neighborHeight = await neighbor.evaluate(element => element.getBoundingClientRect().height);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toHaveText('Show less');
    await expect(expandedCard).toHaveAttribute('expanded', '');
    expect(await neighbor.evaluate(element => element.getBoundingClientRect().height)).toBe(neighborHeight);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toHaveText('Read more');
  });

  test('homepage shows only featured testimonials, capped at four', async ({ page }) => {
    const expectedFeatured = selectFeaturedTestimonials(testimonials).map(testimonial => testimonial.name);
    await page.goto('/');

    const cards = page.locator('expandable-testimonial');
    await expect(cards).toHaveCount(expectedFeatured.length);
    await expect(cards.locator('figcaption p:first-child')).toHaveText(expectedFeatured);
  });
});
