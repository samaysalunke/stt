import { test, expect, type BrowserContext } from '@playwright/test';
import { createRequire } from 'module';
import path from 'path';
import crypto from 'crypto';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const DB_PATH = path.resolve(process.cwd(), 'data/seekthethrill.db');
const BASE = 'http://localhost:4321';

// Fixture trips with far-future departures (src/content/trips/qa-test-*.yaml).
const BOOKABLE = { slug: 'qa-test-bookable', name: 'QA Test — Bookable Trip', batch: 'qa-bookable-2099' };
const COMING_SOON = { slug: 'qa-test-coming-soon', batch: 'qa-cs-open-2099' };

function seedUser(displayName = 'Asha Traveller') {
  const db = new Database(DB_PATH);
  const id = crypto.randomUUID();
  const email = `e2e-pers-${id.slice(0, 8)}@example.invalid`;
  const token = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`INSERT INTO users (id, email, displayName, googleId, createdAt, username, phone, showTripsPublicly, leaderboardOptOut)
    VALUES (?, ?, ?, ?, ?, ?, '9876500000', 0, 0)`).run(id, email, displayName, `google-e2e-pers-${id}`, now, `pers-${id.slice(0, 8)}`);
  db.prepare('INSERT INTO user_sessions (id, userId, token, expiresAt) VALUES (?, ?, ?, ?)').run(crypto.randomUUID(), id, token, now + 86400);
  db.close();
  return { id, email, token };
}

function seedRegistration(email: string, trip: { slug: string; batch: string }, status: string, total = 5000, paid = 1000) {
  const db = new Database(DB_PATH);
  db.prepare(`INSERT INTO registrations (trip_name, trip_slug, batch_id, full_name, email, phone, emergency_name, emergency_phone, status, total_amount, amount_paid, payment_status)
    VALUES ('QA trip', ?, ?, 'Asha Traveller', ?, '9876500000', 'EC', '9876500001', ?, ?, ?, ?)`)
    .run(trip.slug, trip.batch, email, status, total, paid, paid > 0 ? 'advance_paid' : 'unpaid');
  db.close();
}

function seedStats(userId: string, email: string) {
  const db = new Database(DB_PATH);
  db.prepare(`INSERT OR REPLACE INTO leaderboard_cache (userId, email, displayName, kmsFromHome, daysOutdoors, destinationsCount, tripsCount)
    VALUES (?, ?, 'Asha Traveller', 1234, 9, 2, 2)`).run(userId, email);
  db.close();
}

async function signIn(context: BrowserContext, token: string) {
  await context.addCookies([{ name: 'user_session', value: token, url: BASE }]);
}

test.describe('Signed-in home hero', () => {
  test('a booked traveller with a balance sees the trip, the amount and a Pay button', async ({ page, context }) => {
    const user = seedUser();
    seedRegistration(user.email, BOOKABLE, 'confirmed', 5000, 1000);
    await signIn(context, user.token);
    await page.goto('/');

    const hero = page.getByTestId('hero-personal');
    await expect(hero).toHaveAttribute('data-variant', 'trip');
    await expect(hero).toContainText('Welcome back, Asha');
    await expect(hero).toContainText('QA trip'); // the registration's own trip_name
    await expect(page.getByTestId('hero-balance')).toContainText('₹4,000');
    await expect(hero.getByRole('link', { name: 'Pay ₹4,000' })).toHaveAttribute('href', /\/profile\/pay\/\d+/);
    // Above the fold, without scrolling.
    await expect(hero).toBeInViewport();
  });

  test('the header and drawer remind about the balance', async ({ page, context }) => {
    const user = seedUser();
    seedRegistration(user.email, BOOKABLE, 'confirmed', 5000, 1000);
    await signIn(context, user.token);
    await page.goto('/trips/');
    await expect(page.getByTestId('header-balance-dot')).toBeAttached();
    await page.locator('#menu-btn').click();
    await expect(page.getByTestId('drawer-balance')).toContainText('Pay now');
  });

  test('an unfinished booking offers to continue it', async ({ page, context }) => {
    const user = seedUser();
    seedRegistration(user.email, COMING_SOON, 'lead', 5000, 0);
    await signIn(context, user.token);
    await page.goto('/');
    const hero = page.getByTestId('hero-personal');
    await expect(hero).toHaveAttribute('data-variant', 'lead');
    await expect(hero.getByRole('link', { name: 'Continue booking' })).toHaveAttribute('href', `/trips/${COMING_SOON.slug}/book?batch=${COMING_SOON.batch}`);
  });

  test('a past traveller sees their stats', async ({ page, context }) => {
    const user = seedUser();
    seedStats(user.id, user.email);
    await signIn(context, user.token);
    await page.goto('/');
    await expect(page.getByTestId('hero-personal')).toHaveAttribute('data-variant', 'returning');
    await expect(page.getByTestId('hero-stats')).toContainText('1,234 km travelled · 2 trips');
  });

  test('a new account gets a greeting and the usual call to action', async ({ page, context }) => {
    const user = seedUser();
    await signIn(context, user.token);
    await page.goto('/');
    await expect(page.getByTestId('hero-personal')).toHaveAttribute('data-variant', 'new');
    await expect(page.getByRole('link', { name: /Join a Trip/ })).toBeVisible();
  });

  test('signed out, the hero is the shared one', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('hero-personal')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Join a Trip/ })).toBeVisible();
  });
});

test.describe('Trip cards', () => {
  test('a booked trip is badged and a heart saves and unsaves', async ({ page, context }) => {
    const user = seedUser();
    seedRegistration(user.email, BOOKABLE, 'confirmed', 5000, 5000);
    await signIn(context, user.token);
    await page.goto('/trips/');

    const booked = page.getByTestId('trip-card').filter({ hasText: BOOKABLE.name });
    await expect(booked.getByTestId('trip-card-user-state')).toHaveText("You're going");

    const heart = page.locator(`button[data-save-trip="${COMING_SOON.slug}"]`);
    await expect(heart).toHaveAttribute('aria-pressed', 'false');
    await heart.click();
    await expect(heart).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('status')).toContainText('Saved');

    await page.reload();
    await expect(heart).toHaveAttribute('aria-pressed', 'true');
    await page.goto('/');
    await expect(page.getByTestId('saved-trips')).toBeVisible();

    await page.goto('/trips/');
    await heart.click();
    await expect(heart).toHaveAttribute('aria-pressed', 'false');
  });

  test('signed out, the heart goes through sign-in and the save completes on return', async ({ page, context }) => {
    await page.goto('/trips/');
    const heartLink = page.getByRole('link', { name: new RegExp(`Save .* \\(sign in\\)`) }).first();
    await expect(heartLink).toHaveAttribute('href', /^\/login\?next=%2Ftrips%2F%3Fsave%3D/);

    // Google OAuth can't run here; land where the callback would send them.
    const user = seedUser();
    await signIn(context, user.token);
    await page.goto(`/trips/?save=${COMING_SOON.slug}`);
    await expect(page.locator(`button[data-save-trip="${COMING_SOON.slug}"]`)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('status')).toContainText('Saved');
    await expect(page).toHaveURL(/\/trips\/$/);
    await page.reload();
    await expect(page.locator(`button[data-save-trip="${COMING_SOON.slug}"]`)).toHaveAttribute('aria-pressed', 'true');
  });

  test('the sign-in page names the trip being saved', async ({ page }) => {
    await page.goto(`/login?next=${encodeURIComponent(`/trips/?save=${BOOKABLE.slug}`)}`);
    await expect(page.getByText(`Sign in to save ${BOOKABLE.name}`)).toBeVisible();
  });
});

test.describe('Forms', () => {
  test('the custom-itinerary form starts from the account', async ({ page, context }) => {
    const user = seedUser();
    await signIn(context, user.token);
    await page.goto('/custom-itineraries/');
    await expect(page.getByTestId('lead-prefilled')).toBeVisible();
    await expect(page.locator('#lead-name')).toHaveValue('Asha Traveller');
    await expect(page.locator('#lead-email')).toHaveValue(user.email);
    await expect(page.locator('#lead-phone')).toHaveValue('9876500000');
  });
});
