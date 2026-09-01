import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { waitForHydration } from './helpers';

/**
 * Visual-regression oracle for the UI refresh.
 *
 * Phase 3 (marketing pages) is expected to change these snapshots on purpose —
 * review the diff, then `npx playwright test visual.spec.ts --update-snapshots`.
 * Every other phase (shared chrome, booking flow, account, admin) must leave the
 * relevant snapshots byte-identical; a diff there is a regression, not a redesign.
 *
 * Determinism measures:
 *  - all remote hero imagery (images.unsplash.com) is stubbed with a bundled
 *    local file, so runs are offline and pixel-stable
 *  - CSS animations/transitions are frozen (`animations: 'disabled'`) and the
 *    card-skeleton shimmer + scroll-reveal are forced to their resting state
 *  - web fonts are awaited before the shot
 *  - live regions (discount countdowns) are masked
 */

const LOCAL_IMG = readFileSync(fileURLToPath(new URL('../../public/logo.jpg', import.meta.url)));

const VIEWPORTS = [
  { tag: 'mobile', width: 390, height: 844 },
  { tag: 'desktop', width: 1280, height: 900 },
] as const;

// Public routes only. `profile` / `u/[username]` (auth) and `unsubscribe` (token)
// are deliberately excluded until the phase that restyles them.
const ROUTES: { name: string; path: string }[] = [
  { name: 'home', path: '/' },
  { name: 'trips-index', path: '/trips/' },
  { name: 'trip-detail', path: '/trips/qa-test-bookable/' },
  { name: 'trip-book', path: '/trips/qa-test-bookable/book?batch=qa-bookable-2099&tier=standard' },
  { name: 'about', path: '/about/' },
  { name: 'faq', path: '/faq/' },
  { name: 'contact', path: '/contact/' },
  { name: 'custom-itineraries', path: '/custom-itineraries/' },
  { name: 'leaderboard', path: '/leaderboard/' },
  { name: 'photo-vault-index', path: '/photo-vault/' },
  { name: 'terms', path: '/terms/' },
  { name: 'privacy', path: '/privacy/' },
  { name: 'cancellation', path: '/cancellation/' },
  { name: 'login', path: '/login/' },
  { name: 'not-found', path: '/this-route-does-not-exist' },
];

async function freezePage(page: Page) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        caret-color: transparent !important;
      }
      /* card skeleton shimmer → resting */
      [data-card-skeleton]::after { display: none !important; }
      /* scroll-reveal → visible */
      .reveal, .anim-fade-up { opacity: 1 !important; transform: none !important; }
      /* Astro's dev toolbar is a fixed-position overlay injected by the dev
         server. It was being captured into every baseline (a dark pill sitting
         on the viewport-height line, occluding the page content behind it).
         Hidden here rather than via devToolbar in astro.config.mjs so the
         config stays untouched and this stays a test-only concern.
         NB: no backticks in here - this block is inside a template literal. */
      astro-dev-toolbar { display: none !important; }
    `,
  });
  await page.evaluate(() => (document as any).fonts?.ready).catch(() => {});
}

/**
 * Pin the order of every trip listing on the page.
 *
 * Trip listings are SHUFFLED, not sorted: `sortTripsByPriority(..., contentSeededRandom())`
 * seeds a PRNG from `getContentVersion()`, and that counter is persisted in SQLite
 * (`app_meta.content_version`) and bumped by every content writer in src/lib. So it
 * increases monotonically and permanently — including on every `npm run test:api` run,
 * which creates and deletes trips.
 *
 * The consequence for this harness: a baseline containing a trip listing is only valid
 * until the next content write anywhere. It would then "fail" with a full-page diff that
 * is pure reordering and says nothing about styling — which is exactly what happened to
 * home/ and trips/ after an api run.
 *
 * So we normalise order client-side before the shot, the same way we already freeze
 * animations and stub remote images. Sorting by visible title keeps full styling coverage
 * of the cards themselves (a real card regression still diffs) while making the snapshot
 * invariant to the shuffle. Cards are written back into the slots cards already occupied,
 * so any non-card sibling in the same container keeps its position.
 */
async function pinListingOrder(page: Page) {
  await page.evaluate(() => {
    const SEL = '[data-testid="trip-card-title"]';
    const containers = new Set<Element>();

    for (const title of Array.from(document.querySelectorAll(SEL))) {
      let node: Element = title;
      while (node.parentElement) {
        const parent = node.parentElement;
        const cardChildren = Array.from(parent.children).filter((c) => c.querySelector(SEL));
        if (cardChildren.length >= 2) {
          containers.add(parent);
          break;
        }
        node = parent;
      }
    }

    for (const container of containers) {
      const children = Array.from(container.children);
      const slots: number[] = [];
      const cards: Element[] = [];
      children.forEach((child, i) => {
        if (child.querySelector(SEL)) {
          slots.push(i);
          cards.push(child);
        }
      });

      const key = (el: Element) => el.querySelector(SEL)?.textContent?.trim() ?? '';
      cards.sort((a, b) => key(a).localeCompare(key(b)));

      // Re-seat the sorted cards into the slots the cards already held.
      slots.forEach((slot, i) => {
        const ref = container.children[slot];
        if (ref !== cards[i]) container.insertBefore(cards[i], ref);
      });

      // The homepage carousel's script measures card offsets on hydration and
      // parks scrollLeft accordingly. That measurement ran against the
      // pre-sort order, and the scroll offset survives the reorder above — so
      // the row renders correctly ordered but scrolled to an arbitrary
      // position. Rewind it so the shot always starts at the first card.
      let scroller: Element | null = container;
      while (scroller) {
        if (scroller.scrollWidth > scroller.clientWidth) {
          scroller.scrollLeft = 0;
          break;
        }
        scroller = scroller.parentElement;
      }
    }
  });
}

/**
 * Cap every repeated list on an admin page to its first few rows.
 *
 * Admin list pages render DB rows, not content files, and the dev DB holds 612
 * customers — `/admin/customers` is a 95,000px-tall page whose full-page PNG is
 * 7.4MB and which never settles between Playwright's two stability shots (the
 * fixed header repaints at every scroll step of the stitch).
 *
 * Worse, those rows are written by `npm run test:api`, so a full-list baseline
 * expires the moment anyone runs the API suite — the same trap documented on
 * `pinListingOrder` above, one layer down.
 *
 * Capping the rows fixes both: the snapshot stays a styling oracle (chrome,
 * filters, and the row treatment itself are all still captured) while becoming
 * invariant to how many rows the DB happens to hold. Rows are `display:none`d
 * rather than removed so nothing re-lays-out around a missing node.
 *
 * Detection is structural, not per-route: a container qualifies when TWENTY or
 * more of its direct children are the same tag with the same class list.
 *
 * The threshold is the whole design. At six it also caught hand-authored blocks —
 * the ten field rows of `/admin/registrations/new` are ten sibling `<div>`s with
 * one class between them, so the harness quietly hid most of that form and its
 * baseline became a function of which rows happened to share a class string.
 * Editing those classes then moved the snapshot for a reason that had nothing to
 * do with how the page looks, which is the opposite of what this oracle is for.
 * Twenty separates the two populations cleanly: the longest hand-built admin form
 * is ten rows, and the DB-driven lists this exists for run to the hundreds.
 */
const LIST_ROW_THRESHOLD = 20;

async function capAdminLists(page: Page, keep = 3) {
  await page.evaluate(([keepCount, threshold]) => {
    for (const container of Array.from(document.querySelectorAll('*'))) {
      const children = Array.from(container.children) as HTMLElement[];
      if (children.length < threshold) continue;

      const signature = (el: Element) => `${el.tagName}|${el.getAttribute('class') ?? ''}`;
      const counts = new Map<string, HTMLElement[]>();
      for (const child of children) {
        const key = signature(child);
        counts.set(key, [...(counts.get(key) ?? []), child]);
      }

      for (const group of counts.values()) {
        if (group.length < threshold) continue;
        group.slice(keepCount).forEach((el) => { el.style.display = 'none'; });
      }
    }
  }, [keep, LIST_ROW_THRESHOLD] as const);
}

// `/thank-you/` is a 301 to `/trips/` (booking confirmation moved inline onto the
// book page). Screenshotting it produced a byte-duplicate of the trips-index
// baseline, so it is asserted as a redirect rather than snapshotted.
test('thank-you redirects to the trips listing', async ({ page }) => {
  await page.goto('/thank-you/');
  await expect(page).toHaveURL(/\/trips\/$/);
});

test.describe('visual regression — public routes', () => {
  for (const vp of VIEWPORTS) {
    for (const route of ROUTES) {
      test(`${route.name} @ ${vp.tag}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });

        await page.route('**://images.unsplash.com/**', (r) =>
          r.fulfill({ contentType: 'image/jpeg', body: LOCAL_IMG }),
        );

        const resp = await page.goto(route.path, { waitUntil: 'networkidle' });
        // /this-route-does-not-exist intentionally 404s; every other route is 200.
        expect(resp?.status(), route.path).toBeLessThan(route.name === 'not-found' ? 500 : 400);

        await waitForHydration(page).catch(() => {});
        await freezePage(page);
        await pinListingOrder(page);
        await page.waitForTimeout(150); // let the frozen layout settle

        await expect(page).toHaveScreenshot(`${route.name}-${vp.tag}.png`, {
          fullPage: true,
          animations: 'disabled',
          mask: [page.locator('[data-testid="discount-expiry"]')],
          maxDiffPixelRatio: 0.01,
        });
      });
    }
  }
});

/**
 * Admin visual baselines (Phase 6).
 *
 * The admin surface had no snapshot coverage at all, which is why Phase 6 was
 * repeatedly deferred: 499 inline styles with no oracle is not a refactor, it is
 * a rewrite with a screenshot review at the end. These are the Phase 0-equivalent
 * baselines for admin — capture them BEFORE any restyling, and treat a diff on a
 * token-migration commit as a regression unless the change is deliberate.
 *
 * Auth: the handoff claimed this needed a Playwright `storageState` fixture.
 * It does not. `/api/admin/login` is a plain form POST that sets an `admin_token`
 * cookie, and `page.request.post` writes that cookie straight into the test's
 * context — one request per test, no fixture, no setup project.
 *
 * Routes are pinned to content slugs that exist in the repo (`src/content/**`)
 * rather than to DB rows, so they resolve identically on a fresh checkout.
 * `registrations/[slug]` is deliberately absent: its id is a DB row id and is
 * not stable across `npm run test:api`.
 */
const ADMIN_ROUTES: { name: string; path: string }[] = [
  { name: 'admin-login', path: '/admin/login' },
  { name: 'admin-dashboard', path: '/admin/' },
  { name: 'admin-trips', path: '/admin/trips' },
  { name: 'admin-trips-new', path: '/admin/trips/new' },
  { name: 'admin-trips-import', path: '/admin/trips/import' },
  { name: 'admin-trip-detail', path: '/admin/trips/qa-test-bookable' },
  { name: 'admin-registrations', path: '/admin/registrations' },
  { name: 'admin-registrations-new', path: '/admin/registrations/new' },
  { name: 'admin-registrations-import', path: '/admin/registrations/import' },
  { name: 'admin-unpaid-leads', path: '/admin/registrations/unpaid-leads' },
  { name: 'admin-customers', path: '/admin/customers' },
  { name: 'admin-contacts', path: '/admin/contacts' },
  { name: 'admin-analytics', path: '/admin/analytics' },
  { name: 'admin-audit', path: '/admin/audit' },
  { name: 'admin-broadcast', path: '/admin/broadcast' },
  { name: 'admin-newsletter', path: '/admin/newsletter' },
  { name: 'admin-email-logs', path: '/admin/email-logs' },
  { name: 'admin-settings', path: '/admin/settings' },
  { name: 'admin-settings-roles', path: '/admin/settings/roles' },
  { name: 'admin-faqs', path: '/admin/faqs' },
  { name: 'admin-faqs-new', path: '/admin/faqs/new' },
  { name: 'admin-faq-detail', path: '/admin/faqs/what-if-i-need-to-cancel' },
  { name: 'admin-testimonials', path: '/admin/testimonials' },
  { name: 'admin-testimonials-new', path: '/admin/testimonials/new' },
  { name: 'admin-testimonial-detail', path: '/admin/testimonials/riya-sharma' },
  { name: 'admin-photo-vault', path: '/admin/photo-vault' },
  { name: 'admin-photo-vault-new', path: '/admin/photo-vault/new' },
];

test.describe('visual regression — admin routes', () => {
  for (const vp of VIEWPORTS) {
    for (const route of ADMIN_ROUTES) {
      test(`${route.name} @ ${vp.tag}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });

        await page.route('**://images.unsplash.com/**', (r) =>
          r.fulfill({ contentType: 'image/jpeg', body: LOCAL_IMG }),
        );

        // The login page itself must be shot logged-OUT, or it redirects away.
        if (route.name !== 'admin-login') {
          const login = await page.request.post('/api/admin/login', {
            form: { password: process.env.ADMIN_PASSWORD || 'changeme' },
          });
          expect(login.ok(), 'admin login').toBeTruthy();
        }

        const resp = await page.goto(route.path, { waitUntil: 'networkidle' });
        expect(resp?.status(), route.path).toBeLessThan(400);

        await waitForHydration(page).catch(() => {});
        await freezePage(page);
        await capAdminLists(page);
        await page.waitForTimeout(150); // let the frozen layout settle

        await expect(page).toHaveScreenshot(`${route.name}-${vp.tag}.png`, {
          fullPage: true,
          animations: 'disabled',
          maxDiffPixelRatio: 0.01,
        });
      });
    }
  }
});
