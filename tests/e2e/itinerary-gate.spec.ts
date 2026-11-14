import { test, expect } from '@playwright/test';
import { waitForHydration } from './helpers';

// A departure can lock its trip's itinerary until the visitor registers
// (src/lib/itineraryGate.ts). Fixture: src/content/trips/qa-test-itinerary-gate.yaml.
const TRIP = '/trips/qa-test-itinerary-gate/';
const SECRET = 'QA-GATE-SECRET-DAY-TWO';

test('ad landing link: opens the registration form in place, and registering unlocks the plan', async ({ page }) => {
  // The link to put in an ad, Instagram bio or WhatsApp message.
  await page.goto(`${TRIP}#see-itinerary`);
  await waitForHydration(page);
  // Scoped: in dev, Astro's toolbar lists island props (day titles included).
  const plan = page.locator('#itinerary');
  await expect(plan.getByRole('button', { name: 'QA gate preview day' })).toBeVisible();
  expect(await page.content()).not.toContain(SECRET);

  const form = page.getByTestId('itinerary-unlock-form');
  await expect(form.getByText('Full Name').first()).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(new RegExp(`${TRIP}#see-itinerary$`)); // never left the trip page

  const text = form.locator('input[type="text"]');
  await text.nth(0).fill('QA Gate Visitor');
  await text.nth(1).fill('27');
  await form.getByRole('button', { name: 'Select your city' }).click();
  await form.getByPlaceholder('Search city…').fill('Mumbai');
  await form.getByRole('option', { name: 'Mumbai', exact: true }).click();
  await form.getByRole('button', { name: 'Select your state' }).click();
  await form.getByPlaceholder('Search state…').fill('Maharashtra');
  await form.getByRole('option', { name: 'Maharashtra', exact: true }).click();
  await text.nth(5).fill('QA Emergency');
  await form.locator('input[type="email"]').fill(`qa-gate-e2e-${Date.now()}@example.invalid`);
  const tel = form.locator('input[type="tel"]');
  await tel.nth(0).fill('+91 9876543210');
  await tel.nth(1).fill('9123456789');
  await form.locator('textarea').fill('Playwright itinerary gate test.');
  await form.getByRole('button', { name: /See the full itinerary/ }).click();

  await expect(page.getByTestId('itinerary-unlocked-note')).toBeVisible({ timeout: 15_000 });
  await expect(plan.getByRole('button', { name: 'QA gate hidden day two' })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(TRIP)); // still on the trip page

  // A later visit on this browser opens straight away.
  await page.goto(TRIP);
  await expect(page.getByTestId('itinerary-unlocked')).toBeVisible({ timeout: 15_000 });
});

test('the hero link opens the form without a reload', async ({ page }) => {
  await page.goto(TRIP);
  await waitForHydration(page);
  await page.getByTestId('hero-itinerary-link').click();
  await expect(page.getByTestId('itinerary-unlock-form').getByText('Full Name').first()).toBeVisible({ timeout: 15_000 });
});
