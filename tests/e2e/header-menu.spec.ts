/**
 * Keyboard/AT behaviour of the header's slide-out menu drawer.
 *
 * The drawer had no e2e coverage at all, and Lighthouse's `aria-hidden-focus`
 * audit caught why that mattered: the closed overlay was `aria-hidden="true"`
 * but its links and buttons stayed in the tab order, so a keyboard user could
 * tab into an invisible panel. The fix adds `inert`; this spec is what stops it
 * regressing.
 */
import { test, expect } from '@playwright/test';

test('menu drawer: inert when closed, focusable when open, restored on close', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/trips/');

  const overlay = page.locator('#menu-overlay');
  const drawerLink = page.locator('#menu-panel a[href="/faq/"]');

  // closed: inert present, and the drawer's links are unreachable by keyboard
  await expect(overlay).toHaveAttribute('inert', '');
  expect(await drawerLink.evaluate((el) => {
    // an inert subtree reports no focus when asked
    (el as HTMLElement).focus();
    return document.activeElement === el;
  })).toBe(false);

  // open
  await page.locator('#menu-btn').click();
  await expect(overlay).not.toHaveAttribute('inert', '');
  await expect(overlay).toHaveAttribute('aria-hidden', 'false');
  expect(await drawerLink.evaluate((el) => {
    (el as HTMLElement).focus();
    return document.activeElement === el;
  })).toBe(true);

  // close via Escape, then confirm inert comes back after the 300ms transition
  await page.keyboard.press('Escape');
  await expect(overlay).toHaveAttribute('inert', '', { timeout: 2000 });
  await expect(overlay).toHaveAttribute('aria-hidden', 'true');
  expect(await drawerLink.evaluate((el) => {
    (el as HTMLElement).focus();
    return document.activeElement === el;
  })).toBe(false);

  // focus returns to the trigger
  await expect(page.locator('#menu-btn')).toBeFocused();
});
