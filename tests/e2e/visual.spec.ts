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
  // Coverable since the qa-test-album fixture landed; the album page was
  // previously unsnapshottable because src/content/albums/ was empty here.
  { name: 'photo-vault-album', path: '/photo-vault/qa-test-album/' },
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
 * Detection is structural, not per-route. A container qualifies when four or more
 * of its direct children are the same tag with the same class list AND the
 * container is not inside a `<form>`.
 *
 * The form exclusion is what makes the low threshold safe, and getting here took
 * two wrong turns worth recording:
 *
 *  - A bare count of six also matched hand-authored markup — the ten field rows of
 *    `/admin/registrations/new` are ten sibling `<div>`s sharing one class — so the
 *    harness hid most of that form, and its baseline became a function of which
 *    rows happened to share a class string rather than of how the page renders.
 *  - Raising the count to twenty fixed the forms but broke durability the other
 *    way: any admin list holding four to nineteen rows went uncapped, so running
 *    the functional e2e suite (which books trips and creates registrations) moved
 *    the baselines for /admin/registrations, /admin/customers, /admin/email-logs
 *    and /admin/registrations/unpaid-leads.
 *
 * Rendered rows and authored field rows are not distinguishable by count, because
 * the populations overlap. They are distinguishable by container: a field row
 * lives inside the form that submits it, a rendered list row does not. Hence four
 * plus the `closest('form')` test, which caps a four-row list — the case a count
 * alone could never reach without eating forms.
 */
const LIST_ROW_THRESHOLD = 4;

async function capAdminLists(page: Page, keep = 3) {
  await page.evaluate(([keepCount, threshold]) => {
    for (const container of Array.from(document.querySelectorAll('*'))) {
      const children = Array.from(container.children) as HTMLElement[];
      if (children.length < threshold) continue;
      // Field rows belong to the form that submits them; rendered list rows do not.
      if (container.closest('form')) continue;

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

/**
 * Replace the text inside `selector` with fixed-length filler.
 *
 * For a page that is a live event feed, capping the row count is not enough:
 * `/admin/audit` is ordered newest-first, so the three rows the cap leaves are
 * *different rows* after anything writes to the DB, and the baseline moves on
 * content even though the rendering never changed.
 *
 * Masking would fix that by painting the rows out, which also deletes the only
 * thing worth snapshotting there — the row treatment itself. Stubbing keeps the
 * real markup, the real classes and the real layout, and only makes the
 * characters deterministic, so row heights stop depending on how long an actor's
 * email happens to be.
 *
 * The filler contains a space on purpose. An unbreakable run of characters cannot
 * wrap, so a solid token widened narrow table cells and pushed
 * /admin/registrations out to a 554px-wide capture at a 390px viewport — the stub
 * was distorting the very layout it exists to hold still.
 */
async function stubText(page: Page, selector: string) {
  await page.evaluate((sel) => {
    for (const root of Array.from(document.querySelectorAll(sel))) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      while (walker.nextNode()) nodes.push(walker.currentNode as Text);
      for (const node of nodes) {
        if (node.data.trim()) node.data = 'xxx xxx';
      }
    }
  }, selector);
}

// `/thank-you/` is a 301 to `/trips/` (booking confirmation moved inline onto the
// book page). Screenshotting it produced a byte-duplicate of the trips-index
// baseline, so it is asserted as a redirect rather than snapshotted.
test('thank-you redirects to the trips listing', async ({ page }) => {
  await page.goto('/thank-you/');
  await expect(page).toHaveURL(/\/trips\/$/);
});

/**
 * Everything a shot needs done to the live page — freezing, ordering, stubbing —
 * re-applied if the dev server reloaded underneath it.
 *
 * All of that work is injected CSS and DOM mutation, so a navigation throws it
 * away. The dev server's HMR does exactly that: edit a `.astro` file while a run
 * is in flight and the page reloads mid-test, arriving at the screenshot with
 * the animations unfrozen, the trip cards back in their shuffled order and
 * Astro's dev toolbar visible again. That produced a 1.37M-pixel "failure" on
 * trips-index that passed on its own a minute later — a diff that was pure
 * reordering and said nothing about the page.
 *
 * The listener is attached after the initial `goto`, so `loads` counts only
 * reloads that happen during preparation. One retry is enough: a second reload
 * inside the same test would mean something is reloading continuously, and a
 * loop would hide that rather than report it.
 */
async function prepareShot(page: Page, prep: () => Promise<void>) {
  let loads = 0;
  const onLoad = () => { loads += 1; };
  page.on('load', onLoad);
  try {
    await prep();
    if (loads > 0) {
      loads = 0;
      await prep();
      expect(loads, 'page kept reloading while preparing the shot').toBe(0);
    }
  } finally {
    page.off('load', onLoad);
  }
}

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

        await prepareShot(page, async () => {
          await waitForHydration(page).catch(() => {});
          await freezePage(page);
          await pinListingOrder(page);
          await page.waitForTimeout(150); // let the frozen layout settle
        });

        await expect(page).toHaveScreenshot(`${route.name}-${vp.tag}.png`, {
          fullPage: true,
          animations: 'disabled',
          mask: [page.locator('[data-testid="discount-expiry"]')],
          // Same gate as the admin routes below, and for the same reason: a
          // tolerance wide enough to absorb data churn is wide enough to pass a
          // restyle. 1% of a tall public page is ~10 000 pixels.
          //
          // The tolerance was only ever needed because the render was not
          // reproducible. Both causes are now fixed: the data comes from the
          // seeded `.visual-data` database (playwright.config.ts), and the
          // calendar comes from `TEST_NOW` (src/lib/clock.ts) — without which
          // these baselines expire the next time a departure date passes, which
          // is not something a pixel budget can absorb anyway.
          threshold: 0,
          maxDiffPixels: 60,
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
/**
 * `stub` marks a route whose visible copy is a live DB feed.
 *
 * Capping rows fixes how MANY rows a snapshot holds, not WHICH ones. These five
 * are ordered newest-first or carry running totals, so after anything writes to
 * the database — `test:api`, or the functional e2e suite booking a trip — the
 * surviving rows are different rows and the counters have moved, and the baseline
 * fails on content while the rendering is untouched.
 *
 * Stubbing their text makes them a pure layout-and-typography oracle: real
 * markup, real classes, deterministic characters. What a stubbed route can no
 * longer catch is a wrong *value* being rendered, which was never this harness's
 * job — the functional e2e specs cover that.
 */
const ADMIN_ROUTES: {
  name: string;
  path: string;
  stub?: string;
  /** CSS injected before the shot, to pin values the page computes from data. */
  freezeCss?: string;
}[] = [
  { name: 'admin-login', path: '/admin/login' },
  // Stats dashboard: every number is a live query, and the booking-growth bars
  // carry a data-derived inline height. Stubbing settles the text; the bars need
  // the height pinned too, or a single new confirmed seat rescales the chart.
  {
    name: 'admin-dashboard',
    path: '/admin/',
    stub: 'main',
    freezeCss: '.h-36 .rounded-t-lg { height: 50% !important; background: rgba(232,114,90,0.8) !important; }',
  },
  { name: 'admin-trips', path: '/admin/trips' },
  { name: 'admin-trips-new', path: '/admin/trips/new' },
  { name: 'admin-trips-import', path: '/admin/trips/import' },
  { name: 'admin-trip-detail', path: '/admin/trips/qa-test-bookable' },
  { name: 'admin-registrations', path: '/admin/registrations', stub: 'main' },
  { name: 'admin-registrations-new', path: '/admin/registrations/new' },
  { name: 'admin-registrations-import', path: '/admin/registrations/import' },
  { name: 'admin-unpaid-leads', path: '/admin/registrations/unpaid-leads', stub: 'main' },
  { name: 'admin-customers', path: '/admin/customers', stub: 'main' },
  { name: 'admin-contacts', path: '/admin/contacts' },
  { name: 'admin-analytics', path: '/admin/analytics' },
  { name: 'admin-audit', path: '/admin/audit', stub: 'main' },
  { name: 'admin-broadcast', path: '/admin/broadcast' },
  { name: 'admin-newsletter', path: '/admin/newsletter' },
  { name: 'admin-email-logs', path: '/admin/email-logs', stub: 'main' },
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

        await prepareShot(page, async () => {
          await waitForHydration(page).catch(() => {});
          await freezePage(page);
          await capAdminLists(page);
          if (route.freezeCss) await page.addStyleTag({ content: route.freezeCss });
          if (route.stub) await stubText(page, route.stub);
          await page.waitForTimeout(150); // let the frozen layout settle
        });

        await expect(page).toHaveScreenshot(`${route.name}-${vp.tag}.png`, {
          fullPage: true,
          animations: 'disabled',
          // The one piece of admin state the seeded database cannot pin: the
          // trip list renders each YAML file's mtime, and content files live in
          // src/content/, outside DATA_DIR, so both dev servers share them. A
          // `test:api` run rewrites qa-test-bookable.yaml and the card's
          // "Updated <date>" moves to today — 305 pixels, and nothing else on
          // the page changes. Masked rather than stubbed so the rest of the
          // card keeps full coverage.
          mask: [page.locator('[data-trip-updated]')],
          // Two knobs, and the second one matters more than it looks.
          //
          // maxDiffPixelRatio is how many pixels may differ. Zero here, unlike the
          // public routes above: capping and stubbing already removed the data
          // churn that forces those to carry a 1% allowance, and 1% of a tall
          // admin page is ~10k pixels — more than a colour-only change to every
          // secondary label costs, so a 1% gate would pass a restyle in silence.
          //
          // threshold is how different a single pixel must be before it counts at
          // all, and Playwright's default of 0.2 is loose enough to call
          // rgb(130,138,147) and rgb(100,107,118) the same pixel. That is the
          // exact pair this file's contrast work moves text between, so at the
          // default the admin a11y pass registered as zero changed pixels on
          // every route. maxDiffPixelRatio cannot rescue that: no pixel is ever
          // counted, so the ratio is 0 no matter how tight the bound.
          //
          // 0.05 was the first correction and it was still too loose. The badge
          // palette work swapped the email log's "sent" green from #DCFCE7 to
          // #D1FAE5 — an 11/255 delta on one channel, about 4% — and the suite
          // passed. Anything short of exact leaves a band of colour changes the
          // gate cannot see, and there is no principled place to put the line.
          //
          // Exact matching is affordable only because the data is pinned too:
          // the visual project runs against its own seeded database (see
          // playwright.config.ts), so the render is deterministic.
          //
          // What is left is antialiasing on rounded card corners, which does
          // jitter run to run: at threshold 0 with a zero budget, five or six
          // routes fail per run, a different five each time, at 1-22 pixels.
          // Hence an absolute budget rather than a ratio. 60 sits well above the
          // 22-pixel worst case measured across repeat runs and two orders below
          // the smallest change worth catching — one stubbed status pill is
          // ~1 200 pixels. A ratio cannot do this job: 1% of a tall admin page
          // is ~10 000 pixels, which is a whole restyle.
          threshold: 0,
          maxDiffPixels: 60,
        });
      });
    }
  }
});
