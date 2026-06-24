import { test, expect } from '@playwright/test';

// Uses qa-test-booking-panel fixture:
//   dep-A: both tiers, private sold out
//   dep-B: dorm only
//   dep-C: both tiers available
const TRIP_URL = '/trips/qa-test-booking-panel/';

async function waitForPanel(page: any) {
  await page.waitForSelector('[data-testid^="departure-"]', { timeout: 15_000 });
}

test.describe('BookingPanel — explicit selection', () => {
  test('starts without a selected date or occupancy', async ({ page }) => {
    await page.goto(TRIP_URL);
    await waitForPanel(page);

    await expect(page.locator('[data-testid^="tier-"]')).toHaveCount(0);
    await expect(page.locator('#booking-panel-cta')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.locator('#booking-panel-cta')).not.toHaveAttribute('href', /.+/);
  });

  test('selecting a date reveals occupancy without selecting it', async ({ page }) => {
    await page.goto(TRIP_URL);
    await waitForPanel(page);
    await page.click('[data-testid="departure-qa-panel-dep-a"]');

    await expect(page.locator('[data-testid="tier-dorm"]')).toBeVisible();
    await expect(page.locator('[data-testid="tier-dorm"] input')).not.toBeChecked();
    await expect(page.locator('[data-testid="tier-private"] input')).toBeDisabled();
    await expect(page.locator('text=Sold out for these dates')).toBeVisible();
  });

  test('a single occupancy option still requires an explicit choice', async ({ page }) => {
    await page.goto(TRIP_URL);
    await waitForPanel(page);
    await page.click('[data-testid="departure-qa-panel-dep-b"]');

    const dorm = page.locator('[data-testid="tier-dorm"] input');
    await expect(dorm).toBeVisible();
    await expect(dorm).not.toBeChecked();
    await expect(page.locator('#booking-panel-cta')).toHaveAttribute('aria-disabled', 'true');
  });

  test('date and occupancy selection enables checkout with exact parameters', async ({ page }) => {
    await page.goto(TRIP_URL);
    await waitForPanel(page);
    await page.click('[data-testid="departure-qa-panel-dep-c"]');
    await page.click('[data-testid="tier-private"]');

    const cta = page.locator('#booking-panel-cta');
    await expect(cta).toHaveAttribute('aria-disabled', 'false');
    await expect(cta).toHaveAttribute('href', /batch=qa-panel-dep-c&tier=private/);
    await expect(page.locator('text=₹7,000').first()).toBeVisible();
  });

  test('changing dates clears the occupancy selection', async ({ page }) => {
    await page.goto(TRIP_URL);
    await waitForPanel(page);
    await page.click('[data-testid="departure-qa-panel-dep-c"]');
    await page.click('[data-testid="tier-private"]');
    await page.click('[data-testid="departure-qa-panel-dep-b"]');

    await expect(page.locator('[data-testid="tier-dorm"] input')).not.toBeChecked();
    await expect(page.locator('#booking-panel-cta')).toHaveAttribute('aria-disabled', 'true');
  });
});

test.describe('BookingPanel — mobile sticky CTA', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('contains no price and scrolls to the booking chooser', async ({ page }) => {
    await page.goto(TRIP_URL);
    await waitForPanel(page);

    const sticky = page.locator('#booking-sticky');
    await expect(sticky).toBeVisible();
    await expect(sticky.locator('text=/₹[0-9,]+/')).toHaveCount(0);
    // Astro's development toolbar overlaps the bottom edge; production does not.
    await page.locator('#sticky-cta').click({ force: true });
    await expect(page.locator('#booking-panel')).toBeInViewport({ ratio: 0.2 });
  });

  test('hands off to the in-page CTA when it enters the viewport', async ({ page }) => {
    await page.goto(TRIP_URL);
    await waitForPanel(page);
    await page.locator('#booking-panel-cta').scrollIntoViewIfNeeded();

    await expect(page.locator('#booking-sticky')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('#booking-sticky')).toHaveClass(/pointer-events-none/);
  });
});
