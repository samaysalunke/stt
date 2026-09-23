import { test, expect } from '@playwright/test';

/**
 * The page half of first-touch capture (the inline script in BaseLayout).
 *
 * The server half is covered by tests/api/attribution.test.mjs. What can only
 * be proved in a real browser is the part that keeps an Instagram DM booking
 * attributed days later: the localStorage mirror, and the fact that a campaign
 * landing is always reported even when the tab has already sent a touch.
 */

const MIRROR = 'stt_first_touch';
const DM_LINK = '/trips/qa-test-bookable/?utm_source=instagram&utm_medium=dm&utm_campaign=goa-sept&utm_content=reel-ferry&subscriber_id=ig-88421';

type Page = import('@playwright/test').Page;
type Context = import('@playwright/test').BrowserContext;

const readMirror = (page: Page) => page.evaluate((k) => localStorage.getItem(k), MIRROR);

/** The stored mirror, once the beacon has come back. */
async function mirror(page: Page) {
  await expect.poll(() => readMirror(page)).not.toBeNull();
  return JSON.parse((await readMirror(page))!);
}

async function touchCookie(context: Context, name: 'stt_first_touch' | 'stt_latest_touch') {
  const cookie = (await context.cookies()).find((c) => c.name === name);
  return cookie ? JSON.parse(decodeURIComponent(cookie.value)) : null;
}

test('a DM landing is mirrored into localStorage, campaign and subscriber intact', async ({ page, context }) => {
  await page.goto(DM_LINK);

  const stored = await mirror(page);
  expect(stored).toMatchObject({
    utmSource: 'instagram',
    utmMedium: 'dm',
    utmCampaign: 'goa-sept',
    utmContent: 'reel-ferry',
    subscriberId: 'ig-88421',
  });
  // The mirror and the cookie must agree — the mirror only exists to refill the
  // cookie, so a divergence is a silent mis-attribution waiting to happen.
  expect(await touchCookie(context, 'stt_first_touch')).toMatchObject(stored);
});

test('the mirror refills a first-touch cookie that was cleared', async ({ page, context }) => {
  await page.goto(DM_LINK);
  const original = await mirror(page);

  // The 90-day cookie is gone — expired, cleared, or never shared with this
  // storage partition. localStorage is all that is left. A later visit is a new
  // tab, and so a new session: the beacon fires, replays the mirror, and the
  // campaign comes back. (Within the tab that already reported, it does not —
  // the script cannot read an httpOnly cookie, so it cannot know the cookie
  // went missing mid-session. The next visit fixes it, which is the visit that
  // matters for a trip booked days later.)
  await context.clearCookies();
  const later = await context.newPage();
  await later.goto('/trips/qa-test-bookable/');

  await expect.poll(() => touchCookie(context, 'stt_first_touch')).not.toBeNull();
  const restored = await touchCookie(context, 'stt_first_touch');
  expect(restored.utmCampaign).toBe('goa-sept');
  expect(restored.subscriberId).toBe('ig-88421');
  // Restored, not re-dated: the touch keeps the time it actually happened.
  expect(restored.capturedAt).toBe(original.capturedAt);
});

test('a second campaign in the same tab is still reported', async ({ page, context }) => {
  await page.goto('/trips/qa-test-bookable/');
  await mirror(page);

  // Same tab, so the once-per-session flag is already set. A campaign landing
  // has to get through it anyway — this is the visitor who browsed the site
  // first and opened the DM link second, whose campaign was previously never
  // recorded at all. First touch still belongs to the direct visit that
  // actually found them; what this rescues is the latest touch.
  await page.goto(DM_LINK);

  await expect
    .poll(async () => (await touchCookie(context, 'stt_latest_touch'))?.utmCampaign ?? null)
    .toBe('goa-sept');

  expect((await touchCookie(context, 'stt_latest_touch')).subscriberId).toBe('ig-88421');
  // First touch still belongs to the visit that actually found them.
  expect((await touchCookie(context, 'stt_first_touch')).utmCampaign).toBe('');
});

// The endpoint allows 20 posts an hour per IP, and mobile visitors share IPs.
// A flag set on the response rather than on the request means a visitor who
// bounces before the response lands re-posts on every later pageview and can
// burn that budget — after which a real campaign landing gets a 429 and is
// dropped, which is the loss this whole change exists to prevent.
test('a visitor who leaves before the response does not re-post on every page', async ({ page }) => {
  let posts = 0;
  await page.route('**/api/attribution', async (route) => {
    posts++;
    // Hold the response open past the navigation, so the page is gone before
    // any answer could arrive.
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    try { await route.continue(); } catch { /* the page navigated away */ }
  });

  await page.goto('/trips/qa-test-bookable/');
  await page.goto('/trips/', { waitUntil: 'domcontentloaded' });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2_500);

  expect(posts).toBe(1);
});
