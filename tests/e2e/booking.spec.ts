import { test, expect } from '@playwright/test';

// Uses qa-test-booking-panel fixture:
//   dep-A (qa-panel-dep-a): both tiers, private sold out (cap=3, booked=3)
//   dep-B (qa-panel-dep-b): dorm only
//   dep-C (qa-panel-dep-c): both tiers available
const TRIP_URL = '/trips/qa-test-booking-panel/';

async function waitForPanel(page: any) {
  // Wait for React island hydration: the date chooser buttons appear once BookingPanel renders
  await page.waitForSelector('[data-testid^="departure-"]', { timeout: 15_000 });
}

test.describe('BookingPanel — initial load (dep-A selected)', () => {
  test('dorm is pre-selected (cheapest available on dep-A)', async ({ page }) => {
    await page.goto(TRIP_URL);
    await waitForPanel(page);
    const dormLabel = page.locator('[data-testid="tier-dorm"]');
    await expect(dormLabel).toBeVisible();
    const radio = dormLabel.locator('input[type="radio"]');
    await expect(radio).toBeChecked();
  });

  test('summary shows dorm price ₹5,000', async ({ page }) => {
    await page.goto(TRIP_URL);
    await waitForPanel(page);
    // Booking summary "Per person" row
    await expect(page.locator('text=₹5,000').first()).toBeVisible({ timeout: 10_000 });
  });

  test('private shows "Sold out for these dates" on dep-A', async ({ page }) => {
    await page.goto(TRIP_URL);
    await waitForPanel(page);
    await expect(page.locator('[data-testid="tier-private"]')).toBeVisible();
    await expect(page.locator('text=Sold out for these dates')).toBeVisible();
  });

  test('private radio is disabled on dep-A', async ({ page }) => {
    await page.goto(TRIP_URL);
    await waitForPanel(page);
    const radio = page.locator('[data-testid="tier-private"] input[type="radio"]');
    await expect(radio).toBeDisabled();
  });
});

test.describe('BookingPanel — switch to dep-B (dorm only)', () => {
  test('occupancy chooser is hidden', async ({ page }) => {
    await page.goto(TRIP_URL);
    await waitForPanel(page);
    await page.click('[data-testid="departure-qa-panel-dep-b"]');
    // The chooser (radio group) should not be rendered
    await expect(page.locator('[data-testid="tier-dorm"]')).not.toBeVisible();
  });

  test('"Dorm Bed only for these dates." note is visible', async ({ page }) => {
    await page.goto(TRIP_URL);
    await waitForPanel(page);
    await page.click('[data-testid="departure-qa-panel-dep-b"]');
    await expect(page.locator('text=Dorm Bed only for these dates')).toBeVisible({ timeout: 5_000 });
  });
});

test.describe('BookingPanel — switch to dep-C (both available)', () => {
  test('both tiers are selectable', async ({ page }) => {
    await page.goto(TRIP_URL);
    await waitForPanel(page);
    await page.click('[data-testid="departure-qa-panel-dep-c"]');
    await expect(page.locator('[data-testid="tier-dorm"]')).toBeVisible();
    await expect(page.locator('[data-testid="tier-private"]')).toBeVisible();
    const privateRadio = page.locator('[data-testid="tier-private"] input[type="radio"]');
    await expect(privateRadio).not.toBeDisabled();
  });

  test('selecting private updates summary price to ₹7,000', async ({ page }) => {
    await page.goto(TRIP_URL);
    await waitForPanel(page);
    await page.click('[data-testid="departure-qa-panel-dep-c"]');
    await page.click('[data-testid="tier-private"]');
    await expect(page.locator('text=₹7,000').first()).toBeVisible({ timeout: 5_000 });
  });

  test('hidden reg-tier-id input updates to private tierId', async ({ page }) => {
    await page.goto(TRIP_URL);
    await waitForPanel(page);
    await page.click('[data-testid="departure-qa-panel-dep-c"]');
    await page.click('[data-testid="tier-private"]');
    await page.waitForTimeout(200); // allow event to propagate
    const tierId = await page.locator('#reg-tier-id').inputValue();
    expect(tierId).toBe('private');
  });

  test('hidden reg-batch-id updates to dep-C id', async ({ page }) => {
    await page.goto(TRIP_URL);
    await waitForPanel(page);
    await page.click('[data-testid="departure-qa-panel-dep-c"]');
    await page.waitForTimeout(200);
    const batchId = await page.locator('#reg-batch-id').inputValue();
    expect(batchId).toBe('qa-panel-dep-c');
  });
});

test.describe('BookingPanel — sticky bar', () => {
  test('sticky price shows correct amount after selection change', async ({ page }) => {
    await page.goto(TRIP_URL);
    await waitForPanel(page);
    // Switch to dep-C and select private
    await page.click('[data-testid="departure-qa-panel-dep-c"]');
    await page.click('[data-testid="tier-private"]');
    await page.waitForTimeout(300);
    const stickyText = await page.locator('#sticky-price').textContent();
    expect(stickyText).toContain('7,000');
  });
});

test.describe('BookingPanel — mobile viewport (375×812)', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('sticky bar is visible on mobile', async ({ page }) => {
    await page.goto(TRIP_URL);
    await waitForPanel(page);
    const sticky = page.locator('#sticky-price');
    await expect(sticky).toBeVisible();
  });

  test('CTA button is visible and reachable on mobile', async ({ page }) => {
    await page.goto(TRIP_URL);
    await waitForPanel(page);
    const cta = page.locator('a[href="#register"]').last();
    await expect(cta).toBeVisible();
  });

  test('date cards render and are clickable on mobile', async ({ page }) => {
    await page.goto(TRIP_URL);
    await waitForPanel(page);
    const depB = page.locator('[data-testid="departure-qa-panel-dep-b"]');
    await expect(depB).toBeVisible();
    await depB.click();
    await expect(page.locator('text=Dorm Bed only for these dates')).toBeVisible({ timeout: 5_000 });
  });
});
