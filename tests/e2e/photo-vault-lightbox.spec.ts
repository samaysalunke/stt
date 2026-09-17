import { test, expect } from '@playwright/test';

/**
 * GLightbox had no runtime coverage: `src/content/albums/` was empty in this
 * checkout, so no album rendered and the lightbox script never ran. The album
 * page and the day accordion both call `GLightbox({ selector: '[data-glightbox]' })`
 * from a dynamic import, which fails silently — a broken import shows up as
 * "clicking a photo navigates to the raw image" rather than as an error.
 *
 * The fixture is `src/content/albums/qa-test-album.yaml`; scripts/copy-seed.js
 * skips `qa-test-*`, so it never ships.
 */
const ALBUM = '/photo-vault/qa-test-album/';

async function waitForLightboxReady(page: import('@playwright/test').Page) {
  await page.waitForFunction(
    () => document.documentElement.dataset.lightboxReady === '1',
    undefined,
    { timeout: 15_000 },
  );
}

test.describe('photo vault lightbox', () => {
  test('a photo opens in the lightbox rather than navigating away', async ({ page }) => {
    await page.goto(ALBUM);

    const photos = page.locator('a[data-glightbox]');
    await expect(photos).toHaveCount(2);

    // GLightbox binds on a dynamic import and leaves no marker of its own in
    // the DOM. Until that import resolves the anchor is a plain link to the
    // image file, and clicking navigates away. `src/lib/lightbox.ts` sets
    // data-lightbox-ready once the stylesheet has applied and the instance is
    // built, which is the one point where a click is safe.
    await waitForLightboxReady(page);

    await photos.first().click();

    const container = page.locator('.glightbox-container');
    await expect(container).toBeVisible();
    await expect(page.locator('.gslide.current img')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${ALBUM}$`));
  });

  test('the gallery advances and closes', async ({ page }) => {
    await page.goto(ALBUM);
    await waitForLightboxReady(page);
    await page.locator('a[data-glightbox]').first().click();
    await expect(page.locator('.glightbox-container')).toBeVisible();

    await page.locator('.gnext').click();
    await expect(page.locator('.gslide.current img')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('.glightbox-container')).toHaveCount(0);
  });
});
