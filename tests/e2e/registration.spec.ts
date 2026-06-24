import { test, expect } from '@playwright/test';

// ── Trip details page (qa-test-bookable) ─────────────────────────────────────
// This trip uses the legacy schema (flat price, no occupancy chooser).
// The registration form has moved to /trips/[slug]/book — this page is now
// purely browse/marketing with a CTA that navigates to the checkout flow.
const TRIP_URL = '/trips/qa-test-bookable/';
const BOOK_URL = '/trips/qa-test-bookable/book';

async function waitForPanel(page: any) {
  await page.waitForSelector('[data-testid^="departure-"]', { timeout: 15_000 });
}

async function selectBooking(page: any) {
  await waitForPanel(page);
  await page.locator('[data-testid^="departure-"]').first().click();
  await page.locator('[data-testid^="tier-"]').first().click();
}

// ── Trip page — booking summary ───────────────────────────────────────────────
test('booking summary appears after date and occupancy selection', async ({ page }) => {
  await page.goto(TRIP_URL);
  await selectBooking(page);
  await expect(page.locator('text=Advance now').first()).toBeVisible({ timeout: 15_000 });
});

// ── Trip page — CTA navigates to /book ───────────────────────────────────────
test('sidebar "Save my spot" CTA links to the book page', async ({ page }) => {
  await page.goto(TRIP_URL);
  await selectBooking(page);
  // The CTA inside BookingPanel
  const cta = page.locator('a[href*="/book?"]').first();
  await expect(cta).toBeVisible({ timeout: 10_000 });
  const href = await cta.getAttribute('href');
  expect(href).toMatch(/\/trips\/qa-test-bookable\/book\?batch=.+&tier=.+/);
});

test('sticky CTA targets the booking chooser', async ({ page }) => {
  await page.goto(TRIP_URL);
  await waitForPanel(page);
  const sticky = page.locator('#sticky-cta');
  await expect(sticky).toBeAttached({ timeout: 10_000 });
  await expect(sticky).toHaveAttribute('href', '#booking-panel');
});

// ── Book page — Step 1 ────────────────────────────────────────────────────────
test('book page loads Step 1 with trip and price summary', async ({ page }) => {
  await page.goto(`${BOOK_URL}?batch=qa-bookable-2099&tier=standard`);
  // Step bar should show "Your Trip" active
  await expect(page.locator('text=Your Trip').first()).toBeVisible({ timeout: 15_000 });
  // Trip name card (use the card heading specifically)
  await expect(page.locator('div.font-semibold').filter({ hasText: 'QA Test' }).first()).toBeVisible();
  // Advance amount in summary
  await expect(page.locator('text=Advance now').first()).toBeVisible();
});

test('book page Step 1 has a "Continue to your details" button', async ({ page }) => {
  await page.goto(`${BOOK_URL}?batch=qa-bookable-2099&tier=standard`);
  await expect(page.locator('text=Continue to your details')).toBeVisible({ timeout: 15_000 });
});

test('book page Step 1 has a "Back to trip details" link', async ({ page }) => {
  await page.goto(`${BOOK_URL}?batch=qa-bookable-2099&tier=standard`);
  const back = page.locator('a[href*="/trips/qa-test-bookable"]').first();
  await expect(back).toBeVisible({ timeout: 15_000 });
});

// ── Book page — Step 2 ────────────────────────────────────────────────────────
test('book page advances to Step 2 after clicking Continue', async ({ page }) => {
  await page.goto(`${BOOK_URL}?batch=qa-bookable-2099&tier=standard`);
  await page.locator('text=Continue to your details').click();
  await expect(page.locator('text=Your Details')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('input[placeholder*="handle"]')).toBeVisible();
});

test('book page Step 2 shows all required fields', async ({ page }) => {
  await page.goto(`${BOOK_URL}?batch=qa-bookable-2099&tier=standard`);
  await page.locator('text=Continue to your details').click();
  await expect(page.locator('text=Full Name')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('text=Email ID')).toBeVisible();
  await expect(page.locator('text=WhatsApp Number')).toBeVisible();
  await expect(page.locator('text=Emergency Contact')).toBeVisible();
  await expect(page.locator('text=Why do you want to join')).toBeVisible();
});

test('book page Step 2 blocks advance with missing required field', async ({ page }) => {
  await page.goto(`${BOOK_URL}?batch=qa-bookable-2099&tier=standard`);
  await page.locator('text=Continue to your details').click();
  // Click "Continue to payment" without filling anything
  await page.locator('text=Continue to payment').click();
  // Error messages should appear for required fields
  await expect(page.locator('text=is required').first()).toBeVisible({ timeout: 5_000 });
});

// ── Book page — Step 3 ────────────────────────────────────────────────────────
async function fillStep2AndAdvance(page: any) {
  await page.locator('text=Continue to your details').click();
  await expect(page.locator('text=Full Name').first()).toBeVisible({ timeout: 10_000 });

  // text inputs in DOM order: Full Name, Age, City, Instagram, Emergency Name
  const textInputs = page.locator('input[type="text"]');
  await textInputs.nth(0).fill('QA Playwright User'); // Full Name
  await textInputs.nth(1).fill('25');                  // Age
  await textInputs.nth(2).fill('Mumbai');              // City
  await textInputs.nth(3).fill('@qa_pw');              // Instagram
  await textInputs.nth(4).fill('QA Emergency');        // Emergency Name

  // email + tel
  await page.locator('input[type="email"]').first().fill('qa-pw@example.invalid');
  const telInputs = page.locator('input[type="tel"]');
  await telInputs.nth(0).fill('+91 9876543210');  // WhatsApp
  await telInputs.nth(1).fill('9123456789');       // Emergency Phone

  // Why join textarea
  await page.locator('textarea').fill('Playwright E2E QA test.');
  await page.locator('text=Continue to payment').click();
}

test('book page Step 3 shows booking summary, payment instructions, and upload zone', async ({ page }) => {
  await page.goto(`${BOOK_URL}?batch=qa-bookable-2099&tier=standard`);
  await fillStep2AndAdvance(page);
  await expect(page.locator('text=Pay & Confirm')).toBeVisible({ timeout: 10_000 });
  // Booking summary card
  await expect(page.locator('text=Your booking')).toBeVisible();
  // Payment instructions
  await expect(page.locator('text=How to pay')).toBeVisible();
  // Screenshot upload always visible
  await expect(page.locator('text=Upload payment screenshot')).toBeVisible();
  // Secondary action present
  await expect(page.locator('button:has-text("Register without paying")')).toBeVisible();
});

test('book page Step 3 always shows the honesty line', async ({ page }) => {
  await page.goto(`${BOOK_URL}?batch=qa-bookable-2099&tier=standard`);
  await fillStep2AndAdvance(page);
  await expect(page.locator('text=Spots are confirmed only after we verify').first()).toBeVisible({ timeout: 10_000 });
});

test('book page Step 3 "Confirm my spot" is disabled without a screenshot', async ({ page }) => {
  await page.goto(`${BOOK_URL}?batch=qa-bookable-2099&tier=standard`);
  await fillStep2AndAdvance(page);
  await expect(page.locator('button:has-text("Confirm my spot")')).toBeDisabled({ timeout: 10_000 });
});

test('book page Step 3 T&C required for "Register without paying"', async ({ page }) => {
  await page.goto(`${BOOK_URL}?batch=qa-bookable-2099&tier=standard`);
  await fillStep2AndAdvance(page);
  // Do NOT check T&C — submit should show error
  await page.locator('button:has-text("Register without paying")').click();
  await expect(page.locator('text=Please accept the Terms and Cancellation Policy')).toBeVisible({ timeout: 5_000 });
});

test('book page redirects to trip page when batch param is invalid', async ({ page }) => {
  const res = await page.goto(`${BOOK_URL}?batch=bad-batch-id&tier=standard`);
  // Server should redirect back to the trip page
  expect(page.url()).toMatch(/\/trips\/qa-test-bookable\/?$/);
});

// ── Mobile viewport ───────────────────────────────────────────────────────────
test.describe('Book page — mobile (375×812)', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('Step 1 renders and CTA is visible on mobile', async ({ page }) => {
    await page.goto(`${BOOK_URL}?batch=qa-bookable-2099&tier=standard`);
    await expect(page.locator('text=Continue to your details')).toBeVisible({ timeout: 15_000 });
  });

  test('step bar is visible on mobile', async ({ page }) => {
    await page.goto(`${BOOK_URL}?batch=qa-bookable-2099&tier=standard`);
    await expect(page.locator('text=Your Trip')).toBeVisible({ timeout: 15_000 });
  });
});
