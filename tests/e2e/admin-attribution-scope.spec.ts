import { expect, test } from '@playwright/test';

/**
 * The touch scope on the trip page's attribution panel.
 *
 * The client matcher is a hand-written mirror of attributionMatches() in
 * registrationsView.ts — an inline script cannot import — so the rule is
 * verified twice: against the export's SQL in the unit tests, and here against
 * the rows actually on screen.
 */

const TRIP_SLUG = 'qa-test-bookable';
// Unique per run, and on the reserved TLD the API suite's teardown sweeps.
// /api/register is idempotent per email+departure and first touch is
// write-once, so a row left by an earlier run would keep ITS first touch and
// quietly invalidate the seed rather than fail.
const RUN = Date.now();
const CAMPAIGN = `e2e-scope-goa-${RUN}`;
const DM_SECOND = `qa-e2e-scope-dm-${RUN}@example.invalid`;
const DM_FIRST = `qa-e2e-scope-both-${RUN}@example.invalid`;

/**
 * Register a booking carrying a chosen first and latest touch.
 *
 * Each booking gets its OWN request context: the touch cookies are the whole
 * point here, and a shared jar would hand the second booking the first one's
 * first touch — which is write-once, so the seed would silently be wrong rather
 * than fail.
 */
async function seed(playwright: any, baseURL: string, email: string, first: string, latest: string) {
  const ctx = await playwright.request.newContext({ baseURL });
  const beacon = async (search: string) => {
    const res = await ctx.post('/api/attribution', {
      data: { landingPage: `/trips/${TRIP_SLUG}`, search, referrer: '' },
    });
    expect(res.status()).toBe(200);
  };

  await beacon(first);
  // A second visit from the same browser refreshes only the latest touch.
  if (latest !== first) await beacon(latest);

  const res = await ctx.post('/api/register', {
    data: {
      tripSlug: TRIP_SLUG, tripName: 'QA Test — Bookable Trip', batchId: 'qa-bookable-2099',
      tripDate: '1 Jan 2099 – 3 Jan 2099', tripDuration: '3 Days',
      fullName: 'QA Scope', email, phone: '9876543210', age: '30',
      gender: 'prefer-not-to-say', city: 'Mumbai', state: 'Maharashtra',
      emergencyName: 'QA Emergency Contact', emergencyPhone: '9123456789',
      whyJoin: 'Automated QA test submission — safe to ignore.',
      agreeTerms: 'on', intent: 'details',
    },
  });
  expect((await res.json()).success, `seeding ${email}`).toBe(true);
  await ctx.dispose();
}

test('the touch scope finds a campaign only the latest touch carries', async ({ page, playwright, baseURL }) => {
  const dmLink = `?utm_source=instagram&utm_medium=dm&utm_campaign=${CAMPAIGN}`;
  // Found us through search, came back through the DM: the campaign is in the
  // latest touch only.
  await seed(playwright, baseURL!, DM_SECOND, '?utm_source=google&utm_medium=organic', dmLink);
  // Arrived through the DM: the campaign is in both.
  await seed(playwright, baseURL!, DM_FIRST, dmLink, dmLink);

  await page.goto('/admin/login');
  await page.getByText('Password fallback').click();
  await page.getByPlaceholder('Admin password').fill(process.env.ADMIN_PASSWORD || 'changeme');
  await page.getByRole('button', { name: 'Enter Dashboard' }).click();
  await page.goto(`/admin/registrations/${TRIP_SLUG}`);

  const dmSecondRow = page.locator(`.reg-row[data-email="${DM_SECOND}"]`);
  const dmFirstRow = page.locator(`.reg-row[data-email="${DM_FIRST}"]`);
  await expect(dmSecondRow).toHaveCount(1);

  await page.locator('#attr-panel > summary').click();
  const scope = page.locator('#filter-attr-scope');
  const campaign = page.locator('#filter-attr-campaign');

  // Default: first touch. The DM-second row is not a match, and nothing about
  // the existing behaviour changed.
  await expect(scope).toHaveValue('first');
  await campaign.selectOption(CAMPAIGN);
  await expect(dmFirstRow).toBeVisible();
  await expect(dmSecondRow).toBeHidden();

  for (const value of ['latest', 'either']) {
    await scope.selectOption(value);
    await expect(dmSecondRow, `touch=${value}`).toBeVisible();
    await expect(dmFirstRow, `touch=${value}`).toBeVisible();
  }

  // "(no campaign)" under either scope means neither touch has one, so a row
  // whose latest touch carries the campaign is not in that bucket.
  await campaign.selectOption('__none__');
  await expect(dmSecondRow).toBeHidden();

  // The export link has to carry the scope, or the download holds different
  // rows than the screen.
  await campaign.selectOption(CAMPAIGN);
  const href = await page.locator('#registrations-export').getAttribute('href');
  expect(href).toContain(`campaign=${CAMPAIGN}`);
  expect(href).toContain('touch=either');

  // Clearing resets the scope too: leaving it on "either" would silently change
  // what the next filter answers.
  await page.locator('#attr-clear').click();
  await expect(scope).toHaveValue('first');
  await expect(page.locator('#registrations-export')).not.toHaveAttribute('href', /touch=/);
});
