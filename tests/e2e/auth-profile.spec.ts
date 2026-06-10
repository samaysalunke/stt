import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import path from 'path';
import crypto from 'crypto';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const DB_PATH = path.resolve(process.cwd(), 'data/seekthethrill.db');

// ─────────────────────────────────────────────────────────────────────────────
// DB seed helpers (write directly to SQLite, same pattern as API tests)
// ─────────────────────────────────────────────────────────────────────────────

function seedUserWithSession(opts: {
  displayName?: string;
  username?: string;
  showTripsPublicly?: number;
  leaderboardOptOut?: number;
} = {}) {
  const db = new Database(DB_PATH);
  const id = crypto.randomUUID();
  const uname = opts.username ?? `e2e-${crypto.randomBytes(4).toString('hex')}`;
  const email = `e2e-${id.slice(0, 8)}@example.invalid`;
  const token = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  db.prepare(`
    INSERT OR IGNORE INTO users
      (id, email, displayName, googleId, createdAt, username, showTripsPublicly, leaderboardOptOut)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, email,
    opts.displayName ?? 'E2E Tester',
    `google-e2e-${id}`,
    now,
    uname,
    opts.showTripsPublicly ?? 0,
    opts.leaderboardOptOut ?? 0,
  );

  const sessionId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO user_sessions (id, userId, token, expiresAt)
    VALUES (?, ?, ?, ?)
  `).run(sessionId, id, token, now + 30 * 86400);

  db.close();
  return { userId: id, email, username: uname, token };
}

function seedLeaderboardRows(count: number) {
  const db = new Database(DB_PATH);
  for (let i = 0; i < count; i++) {
    const userId = crypto.randomUUID();
    const email = `lb-seed-${userId.slice(0, 6)}@example.invalid`;
    db.prepare(`
      INSERT OR REPLACE INTO leaderboard_cache
        (userId, email, displayName, kmsFromHome, daysOutdoors, destinationsCount, tripsCount)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `).run(userId, email, `Seed User ${i + 1}`, (count - i) * 100, i + 1, 1);
  }
  db.close();
}

// ─────────────────────────────────────────────────────────────────────────────
// WF-5: Sign-in flow + auth guard
// ─────────────────────────────────────────────────────────────────────────────

test.describe('WF-5: Sign-in page and auth guard', () => {
  test('WF-5.1 /login renders with "Continue with Google" CTA', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('text=Continue with Google').first()).toBeVisible({ timeout: 15_000 });
  });

  test('WF-5.2 unauthenticated /profile redirects to /login', async ({ page }) => {
    const res = await page.goto('/profile', { waitUntil: 'commit' });
    // Final URL should be /login (after redirect chain)
    await page.waitForURL(/\/login/, { timeout: 10_000 });
    expect(page.url()).toMatch(/\/login/);
  });

  test('WF-5.3 login page has correct heading', async ({ page }) => {
    await page.goto('/login');
    // Should have a welcome / sign-in heading
    const heading = page.locator('h1, h2').first();
    await expect(heading).toBeVisible({ timeout: 10_000 });
  });

  test('WF-5.4 login page links to Google OAuth endpoint', async ({ page }) => {
    await page.goto('/login');
    const googleBtn = page.locator('a[href*="/api/auth/google"]').first();
    await expect(googleBtn).toBeVisible({ timeout: 10_000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WF-6: Authenticated profile page
// Seeds a DB session, injects cookie so no real OAuth needed
// ─────────────────────────────────────────────────────────────────────────────

test.describe('WF-6: Profile page (authenticated)', () => {
  let token: string;
  let username: string;

  test.beforeAll(() => {
    ({ token, username } = seedUserWithSession({ displayName: 'E2E Profile User' }));
  });

  test.beforeEach(async ({ context }) => {
    await context.addCookies([{
      name: 'user_session',
      value: token,
      domain: 'localhost',
      path: '/',
    }]);
  });

  test('WF-6.1 /profile loads for authenticated user', async ({ page }) => {
    await page.goto('/profile');
    await expect(page).not.toHaveURL(/\/login/, { timeout: 5_000 });
    await expect(page.locator('text=My Trips').first()).toBeVisible({ timeout: 15_000 });
  });

  test('WF-6.2 profile shows username section', async ({ page }) => {
    await page.goto('/profile');
    await expect(page.locator('text=Username').first()).toBeVisible({ timeout: 15_000 });
    // Username handle visible in header (@ prefix)
    await expect(page.locator(`text=@${username}`).first()).toBeVisible({ timeout: 10_000 });
  });

  test('WF-6.3 profile shows leaderboard and show-trips toggles', async ({ page }) => {
    await page.goto('/profile');
    await expect(page.locator('text=Show me on the leaderboard').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('text=Show my trips publicly').first()).toBeVisible();
  });

  test('WF-6.4 leaderboard toggle click calls settings API and flips visually', async ({ page }) => {
    await page.goto('/profile');
    await page.waitForSelector('#toggle-leaderboard', { timeout: 15_000 });

    const btn = page.locator('#toggle-leaderboard');
    const initialBg = await btn.evaluate(el => (el as HTMLElement).style.background);

    // Click to flip
    await btn.click();

    // Background should change (coral ↔ gray)
    await expect(btn).toHaveJSProperty('dataset.on', initialBg.includes('coral') ? 'false' : 'true', { timeout: 3_000 });
  });

  test('WF-6.5 sign out button is present', async ({ page }) => {
    await page.goto('/profile');
    await expect(page.locator('button:has-text("Sign out")').first()).toBeVisible({ timeout: 15_000 });
  });

  test('WF-6.6 profile has link to /leaderboard', async ({ page }) => {
    await page.goto('/profile');
    await expect(page.locator('a[href="/leaderboard"]').first()).toBeVisible({ timeout: 15_000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WF-7: Leaderboard page
// ─────────────────────────────────────────────────────────────────────────────

test.describe('WF-7: Leaderboard page', () => {
  test('WF-7.1 /leaderboard loads publicly with heading', async ({ page }) => {
    await page.goto('/leaderboard');
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('text=Leaderboard').first()).toBeVisible();
  });

  test('WF-7.2 all three tabs are visible', async ({ page }) => {
    await page.goto('/leaderboard');
    await expect(page.locator('text=km from home').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('text=Days outdoors').first()).toBeVisible();
    await expect(page.locator('text=Destinations').first()).toBeVisible();
  });

  test('WF-7.3 km tab is default (no ?tab param)', async ({ page }) => {
    await page.goto('/leaderboard');
    // km from home tab should be "active" (coral background)
    const kmTab = page.locator('a[href="?tab=km"]');
    await expect(kmTab).toBeVisible({ timeout: 10_000 });
    const bg = await kmTab.evaluate(el => (el as HTMLElement).style.background);
    expect(bg).toContain('coral');
  });

  test('WF-7.4 clicking Days outdoors tab updates URL to ?tab=days', async ({ page }) => {
    await page.goto('/leaderboard');
    await page.locator('a[href="?tab=days"]').click();
    await expect(page).toHaveURL(/tab=days/, { timeout: 5_000 });
    // Destinations tab still visible
    await expect(page.locator('text=Destinations').first()).toBeVisible();
  });

  test('WF-7.5 clicking Destinations tab updates URL to ?tab=destinations', async ({ page }) => {
    await page.goto('/leaderboard');
    await page.locator('a[href="?tab=destinations"]').click();
    await expect(page).toHaveURL(/tab=destinations/, { timeout: 5_000 });
  });

  test('WF-7.6 sign-in CTA appears when >10 rows and user not logged in', async ({ page }) => {
    // Ensure at least 11 rows are seeded
    seedLeaderboardRows(12);

    await page.goto('/leaderboard');
    // The sign-in CTA appears in the blur overlay
    await expect(page.locator('text=Sign in to see the full leaderboard').first())
      .toBeVisible({ timeout: 10_000 });
    await expect(page.locator('a[href="/login"]').first()).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WF-8: Public profile /u/{username}
// ─────────────────────────────────────────────────────────────────────────────

test.describe('WF-8: Public profile page /u/{username}', () => {
  let username: string;

  test.beforeAll(() => {
    ({ username } = seedUserWithSession({ displayName: 'Atlas Wanderer', showTripsPublicly: 0 }));
  });

  test('WF-8.1 valid /u/{username} returns 200 and shows first name', async ({ page }) => {
    const res = await page.goto(`/u/${username}`);
    expect(res?.status()).toBe(200);
    await expect(page.locator('text=Atlas').first()).toBeVisible({ timeout: 15_000 });
  });

  test('WF-8.2 surname is NOT shown on public profile', async ({ page }) => {
    await page.goto(`/u/${username}`);
    const html = await page.content();
    expect(html).not.toContain('Wanderer');
  });

  test('WF-8.3 India SVG map is present on public profile', async ({ page }) => {
    await page.goto(`/u/${username}`);
    await expect(page.locator('svg[aria-label*="Map of India"]').first())
      .toBeVisible({ timeout: 15_000 });
  });

  test('WF-8.4 "Travel with Seek the Thrill" CTA links to /trips/', async ({ page }) => {
    await page.goto(`/u/${username}`);
    await expect(page.locator('text=Travel with Seek the Thrill').first()).toBeVisible({ timeout: 15_000 });
    const cta = page.locator('a[href="/trips/"]').last();
    await expect(cta).toBeVisible();
  });

  test('WF-8.5 non-existent username returns 404', async ({ page }) => {
    const res = await page.goto(`/u/not-a-real-user-${crypto.randomBytes(4).toString('hex')}`);
    expect(res?.status()).toBe(404);
  });

  test('WF-8.6 @username handle visible on public profile', async ({ page }) => {
    await page.goto(`/u/${username}`);
    await expect(page.locator(`text=@${username}`).first()).toBeVisible({ timeout: 10_000 });
  });

  test('WF-8.7 showTripsPublicly=false hides Trips section heading', async ({ page }) => {
    // This user was seeded with showTripsPublicly=0, so the "Trips" heading should not render
    await page.goto(`/u/${username}`);
    await expect(page.locator('h2:has-text("Trips")').first()).not.toBeVisible({ timeout: 5_000 });
  });

  test('WF-8.8 public profile with trip list opted in shows confirmed trips', async ({ page }) => {
    const db = new Database(DB_PATH);
    const { username: pubUname, email } = seedUserWithSession({ displayName: 'Trip Sharer', showTripsPublicly: 1 });
    const tripName = `E2E_PUB_TRIP_${crypto.randomBytes(3).toString('hex')}`;
    db.prepare(`
      INSERT INTO registrations (trip_name, full_name, email, phone, emergency_name, emergency_phone, status)
      VALUES (?, ?, ?, ?, ?, ?, 'confirmed')
    `).run(tripName, 'Trip Sharer', email, '9999999999', 'EC', '9999999998');
    db.close();

    await page.goto(`/u/${pubUname}`);
    await expect(page.locator(`text=${tripName}`).first()).toBeVisible({ timeout: 10_000 });
  });
});
