import { test, expect } from '@playwright/test';

const TRIP_URL = '/trips/qa-test-booking-panel/';

test.describe('trip departure hero', () => {
  test('uses back navigation chrome and renders an informational summary', async ({ page }) => {
    await page.goto(TRIP_URL);

    // Scope to page chrome; Astro's dev toolbar uses shadow-DOM <header> nodes.
    await expect(page.locator('body > header')).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toHaveCount(0);
    await expect(page.getByText('Upcoming', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Sold Out', { exact: true })).toHaveCount(0);

    const back = page.locator('[data-back-button]');
    await expect(back).toBeVisible();
    await expect(back).toHaveAttribute('href', '/trips/');

    const summary = page.getByTestId('departure-summary');
    await expect(summary.locator('[data-testid^="hero-departure-"]')).toHaveCount(2);
    await expect(summary).toContainText('Mar 1 – 3');
    await expect(summary).not.toContainText(/\d+ spots?/);
    await expect(page.getByTestId('departure-more')).toHaveText('+1 more');
    await expect(summary.locator('button, a, input')).toHaveCount(0);
    await expect(summary).toHaveCSS('overflow-x', 'visible');
  });

  test('trip listing cards show the same static departure pills', async ({ page }) => {
    await page.goto('/trips/');

    const card = page.locator('article').filter({ hasText: 'QA Test — Booking Panel' });
    const summary = card.getByTestId('card-departure-summary');
    await expect(summary).toBeVisible();
    await expect(summary.locator('span[data-sold-out]')).toHaveCount(2);
    await expect(summary).toContainText('Mar 1 – 3');
    await expect(summary).toContainText('+1 more');
    await expect(summary).not.toContainText(/\d+ spots?/);
    await expect(summary.locator('button, a, input')).toHaveCount(0);
    await expect(summary.locator('xpath=..')).toHaveClass(/relative/);
  });

  test('direct navigation back control falls back to the trips index', async ({ page }) => {
    await page.goto(TRIP_URL);
    await page.locator('[data-back-button]').click();
    await expect(page).toHaveURL(/\/trips\/$/);
  });

  test('summary does not select a booking date', async ({ page }) => {
    await page.goto(TRIP_URL);
    await page.waitForSelector('[data-testid^="departure-"]');
    await page.getByTestId('hero-departure-qa-panel-dep-a').click();

    await expect(page.locator('[data-testid^="tier-"]')).toHaveCount(0);
    await expect(page.locator('#booking-panel-cta')).toHaveAttribute('aria-disabled', 'true');
  });

  test('renders inherited FAQs at the end and emits matching FAQPage data', async ({ page }) => {
    await page.goto(TRIP_URL);
    const heading = page.getByRole('heading', { name: 'Frequently asked questions' });
    await expect(heading).toBeVisible();
    await expect(page.locator('section[aria-labelledby="trip-faq-heading"] details')).toHaveCount(19);

    const structuredFaqs = await page.locator('script[type="application/ld+json"]').evaluateAll((scripts) =>
      scripts.flatMap((script) => {
        const data = JSON.parse(script.textContent || '{}');
        return (data['@graph'] || []).filter((node: any) => node['@type'] === 'FAQPage');
      }),
    );
    expect(structuredFaqs).toHaveLength(1);
    expect(structuredFaqs[0].mainEntity).toHaveLength(19);
    expect(structuredFaqs[0].mainEntity[0].name).toBe(
      await page.locator('section[aria-labelledby="trip-faq-heading"] summary span').first().textContent(),
    );
  });

  test('places FAQs after the sold-out message without horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto('/trips/qa-test-sold-out/');
    const soldOut = page.getByText('All spots on this trip are filled.');
    const faqHeading = page.getByRole('heading', { name: 'Frequently asked questions' });
    await expect(soldOut).toBeVisible();
    await expect(faqHeading).toBeVisible();
    expect(await soldOut.evaluate((message, heading) =>
      Boolean(message.compareDocumentPosition(heading as Node) & Node.DOCUMENT_POSITION_FOLLOWING),
      await faqHeading.elementHandle(),
    )).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  for (const viewport of [
    { width: 320, height: 568 },
    { width: 375, height: 667 },
    { width: 390, height: 844 },
  ]) {
    test(`fits the initial viewport at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(TRIP_URL);

      await expect(page.locator('[data-testid^="hero-departure-"]').first()).toBeInViewport();
      const layout = await page.evaluate(() => {
        const hero = document.querySelector('[data-testid="trip-hero"]')!;
        const content = hero.querySelector('.container-app')!;
        const heroRect = hero.getBoundingClientRect();
        const contentRect = content.getBoundingClientRect();
        return {
          noHorizontalOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          contentInsideHero: contentRect.top >= heroRect.top && contentRect.bottom <= heroRect.bottom + 1,
        };
      });
      expect(layout.noHorizontalOverflow).toBe(true);
      expect(layout.contentInsideHero).toBe(true);
    });
  }
});
