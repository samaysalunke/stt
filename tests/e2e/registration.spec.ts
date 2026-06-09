import { test, expect } from '@playwright/test';

// Uses qa-test-bookable (legacy schema) — single standard tier, no occupancy chooser.
// Tests the full public flow: load page → booking summary visible → CTA scrolls to form.
const TRIP_URL = '/trips/qa-test-bookable/';

test('booking summary is visible on page load', async ({ page }) => {
  await page.goto(TRIP_URL);
  // The booking summary "Advance now" section appears once BookingPanel hydrates
  await expect(page.locator('text=Advance now').first()).toBeVisible({ timeout: 15_000 });
});

test('"Save my spot" CTA scrolls to the registration form', async ({ page }) => {
  await page.goto(TRIP_URL);
  await page.waitForSelector('a[href="#register"]', { timeout: 15_000 });
  // Click the sidebar CTA (first occurrence — the one inside the booking panel)
  await page.locator('a[href="#register"]').first().click();
  // Registration form heading should now be in view
  await expect(page.locator('#register')).toBeVisible();
});

test('registration form has required fields', async ({ page }) => {
  await page.goto(TRIP_URL);
  await page.waitForSelector('#reg-form', { timeout: 15_000 });
  const form = page.locator('#reg-form');
  await expect(form.locator('input[name="fullName"]')).toBeVisible();
  await expect(form.locator('input[name="email"]')).toBeVisible();
  await expect(form.locator('input[name="phone"]')).toBeVisible();
});

test('hidden batchId input is populated from BookingPanel', async ({ page }) => {
  await page.goto(TRIP_URL);
  // Wait for BookingPanel to hydrate and fire stt:booking-changed
  await page.waitForSelector('text=Advance now', { timeout: 15_000 });
  await page.waitForTimeout(300);
  const batchId = await page.locator('#reg-batch-id').inputValue();
  expect(batchId).toBeTruthy();
  expect(batchId).toBe('qa-bookable-2099');
});

test('form submission with missing required field shows client-side block (HTML5 validation)', async ({ page }) => {
  await page.goto(TRIP_URL);
  await page.waitForSelector('#reg-form', { timeout: 15_000 });
  // Try to submit empty form — HTML5 required validation should block it
  await page.locator('#reg-form').evaluate((form: HTMLFormElement) => {
    // Dispatch submit to trigger validation without actual network request
    form.reportValidity();
  });
  // At least one required field should show browser validation state
  const invalid = page.locator('#reg-form input:invalid');
  expect(await invalid.count()).toBeGreaterThan(0);
});
