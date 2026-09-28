import { test, expect, type APIRequestContext } from '@playwright/test';
import { gotoHydrated } from './helpers';

// Uses the qa-test-occupancy fixture: one departure (qa-occ-2099), dorm cap 12
// + private cap 4 + solo cap 0 = 16 seats. Both lines count CONFIRMED
// registrations only, so a pending one must not move either number.
const TRIP = { slug: 'qa-test-occupancy', title: 'QA Test — Occupancy Change', batchId: 'qa-occ-2099' };
const TIERS = ['dorm', 'private', 'solo'];

// Shares the fixture's DB rows and YAML counters, so no parallel runs.
test.describe.configure({ mode: 'serial' });

async function adminRequest(request: APIRequestContext) {
  const res = await request.post('/api/admin/login', {
    multipart: { password: process.env.ADMIN_PASSWORD || 'changeme' },
    maxRedirects: 0,
  });
  const cookie = (res.headers()['set-cookie'] ?? '').match(/admin_token=[^;]+/)?.[0] ?? '';
  expect(cookie, 'admin login').not.toBe('');
  return cookie;
}

async function cleanup(request: APIRequestContext) {
  for (const tierId of TIERS) {
    await request.post('/api/test/cleanup', { data: { batchId: TRIP.batchId, tierId, tripTitle: TRIP.title } });
  }
}

async function createReg(
  request: APIRequestContext, cookie: string,
  opts: { tierId: string; status: 'confirmed' | 'pending'; gender: string },
) {
  const email = `qa-urgency-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.invalid`;
  const res = await request.post('/api/admin/registrations/create', {
    headers: { cookie },
    data: {
      tripSlug: TRIP.slug, batchId: TRIP.batchId, tierId: opts.tierId, status: opts.status,
      full_name: 'QA Urgency', email, phone: '9876543210', gender: opts.gender, sendEmail: false,
    },
  });
  expect(res.status(), await res.text()).toBe(200);
}

test.beforeEach(async ({ request }) => cleanup(request));
test.afterAll(async ({ request }) => cleanup(request));

test('shows spots left under 5 and the women count from confirmed bookings only', async ({ page, request }) => {
  const cookie = await adminRequest(request);
  // 13 confirmed of 16 → 3 left. Two confirmed women; the pending woman is ignored.
  await createReg(request, cookie, { tierId: 'dorm', status: 'confirmed', gender: 'female' });
  await createReg(request, cookie, { tierId: 'dorm', status: 'confirmed', gender: 'female' });
  for (let i = 0; i < 10; i++) await createReg(request, cookie, { tierId: 'dorm', status: 'confirmed', gender: 'male' });
  await createReg(request, cookie, { tierId: 'private', status: 'confirmed', gender: 'male' });
  await createReg(request, cookie, { tierId: 'private', status: 'pending', gender: 'female' });

  await gotoHydrated(page, `/trips/${TRIP.slug}/`);
  await expect(page.getByTestId(`spots-left-${TRIP.batchId}`)).toHaveText('Only 3 spots left');
  // The women line belongs to the selected date (a lone date is preselected).
  await page.click(`[data-testid="departure-${TRIP.batchId}"]`);
  await expect(page.getByTestId('women-booked')).toHaveText('2 women already booked on these dates');

  await page.goto('/trips/');
  const card = page.locator('[data-testid="trip-card"]', { has: page.locator(`a[href="/trips/${TRIP.slug}/"]`) });
  await expect(card.getByTestId('trip-card-spots-left')).toHaveText('Only 3 spots left');
});

test('hides both lines with plenty of room and a single woman', async ({ page, request }) => {
  const cookie = await adminRequest(request);
  await createReg(request, cookie, { tierId: 'dorm', status: 'confirmed', gender: 'female' });

  await gotoHydrated(page, `/trips/${TRIP.slug}/`);
  await page.click(`[data-testid="departure-${TRIP.batchId}"]`);
  await expect(page.getByTestId(`tier-dorm`)).toBeVisible();
  await expect(page.getByTestId(`spots-left-${TRIP.batchId}`)).toHaveCount(0);
  await expect(page.getByTestId('women-booked')).toHaveCount(0);
});
