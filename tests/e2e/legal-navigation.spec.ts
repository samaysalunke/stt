import { test, expect } from '@playwright/test';

test.describe('legal pages and navigation drawer', () => {
  test('homepage header stays hidden over the hero and appears after it', async ({ page }) => {
    await page.goto('/');

    const header = page.locator('#site-header');
    await expect(header).not.toHaveClass(/header-visible/);

    await page.locator('#homepage-hero + section').scrollIntoViewIfNeeded();
    await expect(header).toHaveClass(/header-visible/);

    await page.locator('#homepage-hero').scrollIntoViewIfNeeded();
    await expect(header).not.toHaveClass(/header-visible/);
  });

  for (const pageInfo of [
    { path: '/cancellation/', slug: 'cancellation', title: 'Cancellation Policy', date: 'August 2026' },
    { path: '/terms/', slug: 'terms', title: 'Terms & Conditions', date: 'June 2025' },
    { path: '/privacy/', slug: 'privacy', title: 'Privacy Policy', date: 'March 2025' },
  ]) {
    test(`${pageInfo.title} uses the shared legal shell`, async ({ page }) => {
      await page.goto(pageInfo.path);
      await expect(page.getByRole('heading', { level: 1, name: pageInfo.title })).toBeVisible();
      await expect(page.getByText(`Last updated ${pageInfo.date}`)).toBeVisible();
      await expect(page.locator('.legal-support')).toBeVisible();
      if (process.env.CAPTURE_UI === 'true') {
        await page.screenshot({ path: `/tmp/stt-${pageInfo.slug}-desktop.png`, fullPage: true });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({ path: `/tmp/stt-${pageInfo.slug}-mobile.png`, fullPage: true });
      }
    });
  }

  test('signed-out drawer promotes sign in and exposes grouped navigation', async ({ page }) => {
    await page.goto('/trips/');
    await page.getByRole('button', { name: 'Open menu' }).click();

    const drawer = page.getByRole('dialog', { name: 'Site navigation' });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('Seek the Thrill')).toBeVisible();
    await expect(drawer.getByText('Small groups. Offbeat India.')).toBeVisible();
    await expect(drawer.getByRole('link', { name: /Sign in/ })).toBeVisible();
    await expect(drawer.getByRole('heading', { name: 'Explore' })).toBeVisible();
    await expect(drawer.getByRole('heading', { name: 'Support' })).toBeVisible();
    await expect(drawer.getByRole('heading', { name: 'Legal' })).toBeVisible();

    if (process.env.CAPTURE_UI === 'true') {
      await page.screenshot({ path: '/tmp/stt-navigation-drawer-desktop.png', fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: '/tmp/stt-navigation-drawer-mobile.png', fullPage: true });
    }

    await page.keyboard.press('Escape');
    await expect(drawer).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Open menu' })).toBeFocused();
  });

  test('photo vault stays directly accessible but is excluded from public navigation', async ({ page }) => {
    await page.goto('/photo-vault/');
    await expect(page.getByRole('heading', { level: 1, name: 'The Vault' })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, follow');

    await page.goto('/trips/');
    await page.getByRole('button', { name: 'Open menu' }).click();
    await expect(page.getByRole('dialog', { name: 'Site navigation' }).getByRole('link', { name: /Photo vault/i })).toHaveCount(0);
    await expect(page.locator('footer').getByRole('link', { name: /Photo vault/i })).toHaveCount(0);
  });
});
