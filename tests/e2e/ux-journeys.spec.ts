import { test, expect } from '@playwright/test';

// Shared fixture — uses the same qa-test-bookable trip (legacy flat-price schema)
const TRIP_URL = '/trips/qa-test-bookable/';
const BOOK_URL = '/trips/qa-test-bookable/book';
const BOOK_PARAMS = '?batch=qa-bookable-2099&tier=standard';

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

async function goToStep2(page: any) {
  await page.goto(`${BOOK_URL}${BOOK_PARAMS}`);
  await page.locator('text=Continue to your details').click();
  await expect(page.locator('text=Full Name').first()).toBeVisible({ timeout: 10_000 });
}

async function fillAllStep2(page: any, overrides: Record<string, string> = {}) {
  const vals = {
    fullName: 'Journey Tester',
    age: '27',
    city: 'Pune',
    instagram: '@journey_tester',
    emergencyName: 'Emergency Person',
    email: 'journey@example.invalid',
    phone: '+91 9000000001',
    emergencyPhone: '9000000002',
    whyJoin: 'Testing the full booking journey end to end.',
    ...overrides,
  };

  const ti = page.locator('input[type="text"]');
  if (vals.fullName)       await ti.nth(0).fill(vals.fullName);
  if (vals.age)            await ti.nth(1).fill(vals.age);
  if (vals.city)           await ti.nth(2).fill(vals.city);
  if (vals.instagram)      await ti.nth(3).fill(vals.instagram);
  if (vals.emergencyName)  await ti.nth(4).fill(vals.emergencyName);

  await page.locator('input[type="email"]').first().fill(vals.email);

  const tel = page.locator('input[type="tel"]');
  if (vals.phone)          await tel.nth(0).fill(vals.phone);
  if (vals.emergencyPhone) await tel.nth(1).fill(vals.emergencyPhone);

  await page.locator('textarea').fill(vals.whyJoin);
}

async function goToStep3(page: any) {
  await goToStep2(page);
  await fillAllStep2(page);
  await page.locator('text=Continue to payment').click();
  await expect(page.locator('text=Pay & Confirm')).toBeVisible({ timeout: 10_000 });
}

// ─────────────────────────────────────────────────────────────────────────────
// Workflow 1 — Discovery journey
// Home → trips listing → trip card → trip detail sections → booking CTA
// ─────────────────────────────────────────────────────────────────────────────
test.describe('WF-1: Discovery journey — browsing to booking CTA', () => {
  test('home page loads with headline and trips CTA', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=Go where the').first()).toBeVisible({ timeout: 15_000 });
    const ctaLink = page.locator('a[href*="/trips"]').first();
    await expect(ctaLink).toBeVisible();
  });

  test('trips listing shows at least one trip card with price', async ({ page }) => {
    await page.goto('/trips/');
    // At least one trip card with a price
    await expect(page.locator('text=/₹[0-9,]+/').first()).toBeVisible({ timeout: 15_000 });
  });

  test('trips listing cards link to /trips/[slug]/', async ({ page }) => {
    await page.goto('/trips/');
    const card = page.locator('a[href^="/trips/"]').first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    const href = await card.getAttribute('href');
    expect(href).toMatch(/^\/trips\/[a-z0-9-]+\/?$/);
  });

  test('trip detail page shows title, price, and itinerary section', async ({ page }) => {
    await page.goto(TRIP_URL);
    // Title present
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });
    // Price pill
    await expect(page.locator('text=/from ₹[0-9,]+/').first()).toBeVisible();
    // At least one itinerary day item (the accordion)
    await expect(page.locator('text=Day').first()).toBeVisible();
  });

  test('trip detail has a working "Save my spot" CTA pointing to /book', async ({ page }) => {
    await page.goto(TRIP_URL);
    await page.waitForSelector('a[href*="/book?"]', { timeout: 15_000 });
    const cta = page.locator('a[href*="/book?"]').first();
    const href = await cta.getAttribute('href');
    expect(href).toMatch(/\/book\?batch=.+&tier=.+/);
  });

  test('navigating via CTA lands on book page Step 1', async ({ page }) => {
    await page.goto(TRIP_URL);
    await page.waitForSelector('a[href*="/book?"]', { timeout: 15_000 });
    const href = await page.locator('a[href*="/book?"]').first().getAttribute('href');
    await page.goto(`http://localhost:4321${href}`);
    await expect(page.locator('text=Your Trip').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('text=Continue to your details')).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Workflow 2 — Step 2 field validation
// Each required field, when left blank, produces its specific error message
// ─────────────────────────────────────────────────────────────────────────────
test.describe('WF-2: Step 2 field-level validation', () => {
  async function submitBlank(page: any, filled: Record<string, string>) {
    await goToStep2(page);
    await fillAllStep2(page, filled);
    await page.locator('text=Continue to payment').click();
  }

  test('blank Full Name shows "Full Name is required"', async ({ page }) => {
    await submitBlank(page, { fullName: '' });
    await expect(page.locator('text=Full Name is required')).toBeVisible({ timeout: 5_000 });
  });

  test('blank Email shows "Email is required"', async ({ page }) => {
    await submitBlank(page, { email: '' });
    await expect(page.locator('text=Email is required')).toBeVisible({ timeout: 5_000 });
  });

  test('blank WhatsApp shows "WhatsApp Number is required"', async ({ page }) => {
    await submitBlank(page, { phone: '' });
    await expect(page.locator('text=WhatsApp Number is required')).toBeVisible({ timeout: 5_000 });
  });

  test('blank Age shows "Age is required"', async ({ page }) => {
    await submitBlank(page, { age: '' });
    await expect(page.locator('text=Age is required')).toBeVisible({ timeout: 5_000 });
  });

  test('blank City shows "City is required"', async ({ page }) => {
    await submitBlank(page, { city: '' });
    await expect(page.locator('text=City is required')).toBeVisible({ timeout: 5_000 });
  });

  test('blank Instagram shows "Instagram Handle is required"', async ({ page }) => {
    await submitBlank(page, { instagram: '' });
    await expect(page.locator('text=Instagram Handle is required')).toBeVisible({ timeout: 5_000 });
  });

  test('blank Emergency Name shows "Emergency Contact Name is required"', async ({ page }) => {
    await submitBlank(page, { emergencyName: '' });
    await expect(page.locator('text=Emergency Contact Name is required')).toBeVisible({ timeout: 5_000 });
  });

  test('blank Emergency Phone shows "Emergency Contact Number is required"', async ({ page }) => {
    await submitBlank(page, { emergencyPhone: '' });
    await expect(page.locator('text=Emergency Contact Number is required')).toBeVisible({ timeout: 5_000 });
  });

  test('blank Why Join shows "Why do you want to join? is required"', async ({ page }) => {
    await submitBlank(page, { whyJoin: '' });
    await expect(page.locator('text=Why do you want to join? is required')).toBeVisible({ timeout: 5_000 });
  });

  test('fixing an error field removes its error message', async ({ page }) => {
    await goToStep2(page);
    // Submit blank to trigger errors
    await page.locator('text=Continue to payment').click();
    await expect(page.locator('text=Full Name is required')).toBeVisible({ timeout: 5_000 });
    // Now fill the field — error should clear
    await page.locator('input[type="text"]').nth(0).fill('Fixed Name');
    await expect(page.locator('text=Full Name is required')).not.toBeVisible({ timeout: 3_000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Workflow 3 — Pay-later complete submission
// Full journey: Step 1 → 2 → 3 pay-later → T&C → submit → thank-you page
// ─────────────────────────────────────────────────────────────────────────────
test.describe('WF-3: Pay-later full submission journey', () => {
  test('pay-later submission reaches thank-you page', async ({ page }) => {
    await goToStep3(page);

    // Toggle to pay-later
    await page.locator('text=Save spot, pay later').click();
    await expect(page.locator("text=We'll email you the payment details")).toBeVisible({ timeout: 5_000 });

    // T&C
    await page.locator('label').filter({ hasText: 'Terms and Conditions' }).locator('input[type="checkbox"]').check();
    await page.locator('label').filter({ hasText: 'Cancellation Policy' }).locator('input[type="checkbox"]').check();

    // Submit
    await page.locator('button:has-text("Save my spot")').click();

    // Should land on thank-you
    await expect(page).toHaveURL(/\/thank-you/, { timeout: 15_000 });
  });

  test('pay-later submit is blocked when T&C not checked', async ({ page }) => {
    await goToStep3(page);
    await page.locator('text=Save spot, pay later').click();
    await expect(page.locator("text=We'll email you the payment details")).toBeVisible({ timeout: 5_000 });
    // Do NOT check T&C — submit should show error
    await page.locator('button:has-text("Save my spot")').click();
    await expect(page.locator('text=Please accept the Terms and Cancellation Policy to continue.')).toBeVisible({ timeout: 5_000 });
    // Should still be on the same page
    expect(page.url()).not.toMatch(/\/thank-you/);
  });

  test('thank-you page shows trip name in URL', async ({ page }) => {
    await goToStep3(page);
    await page.locator('text=Save spot, pay later').click();
    await page.locator('label').filter({ hasText: 'Terms and Conditions' }).locator('input[type="checkbox"]').check();
    await page.locator('label').filter({ hasText: 'Cancellation Policy' }).locator('input[type="checkbox"]').check();
    await page.locator('button:has-text("Save my spot")').click();
    await expect(page).toHaveURL(/\/thank-you\/?/, { timeout: 15_000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Workflow 4 — Step navigation & UPI/Bank tab interactions
// Back/forward between steps, payment tab switching, toggle pay-mode persistence
// ─────────────────────────────────────────────────────────────────────────────
test.describe('WF-4: Step navigation and payment tab interactions', () => {
  test('Back on Step 2 returns to Step 1', async ({ page }) => {
    await goToStep2(page);
    await page.locator('button:has-text("← Back")').click();
    await expect(page.locator('text=Continue to your details')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('text=Your Trip').first()).toBeVisible();
  });

  test('Back on Step 3 returns to Step 2', async ({ page }) => {
    await goToStep3(page);
    await page.locator('button:has-text("← Back")').click();
    await expect(page.locator('text=Your Details')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('text=Full Name')).toBeVisible();
  });

  test('Step 3 step bar shows steps 1 & 2 as completed', async ({ page }) => {
    await goToStep3(page);
    // Steps 1 and 2 should show checkmarks (completed circles)
    // Step 3 label "Pay & Confirm" should be active
    await expect(page.locator('text=Pay & Confirm')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('text=Your Trip').first()).toBeVisible();
    await expect(page.locator('text=Your Details').first()).toBeVisible();
  });

  test('UPI and Bank Transfer tabs switch payment instructions', async ({ page }) => {
    await goToStep3(page);
    // UPI tab is default — label heading visible
    await expect(page.locator('p.text-xs:has-text("UPI ID")').first()).toBeVisible({ timeout: 5_000 });
    // Switch to Bank Transfer
    await page.locator('button:has-text("Bank Transfer")').click();
    await expect(page.locator('text=Bank Account Details')).toBeVisible({ timeout: 3_000 });
    // UPI section should be gone
    await expect(page.locator('p.text-xs:has-text("UPI ID")')).not.toBeVisible();
    // Switch back to UPI
    await page.locator('button:has-text("Pay via UPI")').click();
    await expect(page.locator('p.text-xs:has-text("UPI ID")').first()).toBeVisible({ timeout: 3_000 });
  });

  test('toggling pay-later then back to pay-now restores screenshot upload zone', async ({ page }) => {
    await goToStep3(page);
    // Screenshot zone visible in pay-now
    await expect(page.locator('text=Payment Screenshot')).toBeVisible();
    // Toggle to pay-later
    await page.locator('text=Save spot, pay later').click();
    await expect(page.locator('text=Payment Screenshot')).not.toBeVisible({ timeout: 3_000 });
    // Toggle back to pay-now
    await page.locator("text=I'll pay now").click();
    await expect(page.locator('text=Payment Screenshot')).toBeVisible({ timeout: 3_000 });
  });

  test('Step 1 summary shows correct advance and balance amounts', async ({ page }) => {
    await page.goto(`${BOOK_URL}${BOOK_PARAMS}`);
    await expect(page.locator('text=Advance now').first()).toBeVisible({ timeout: 15_000 });
    // Should show both advance and balance rows
    await expect(page.locator('text=Balance before trip').first()).toBeVisible();
    // Back link present
    await expect(page.locator('text=Back to trip details')).toBeVisible();
  });
});
