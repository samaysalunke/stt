import { expect, test } from '@playwright/test';

/**
 * The city column is geocoded, and those coordinates place both the
 * leaderboard's km and the pins on public profile maps. Admin used to take it
 * as free text, which is how `Tumahare dil mein`, `nowhere` and `banglore`
 * reached it. The picker mirrors the public checkout's, escape hatch included.
 */
async function signIn(page) {
  await page.goto('/admin/login');
  await page.getByText('Password fallback').click();
  await page.getByPlaceholder('Admin password').fill(process.env.ADMIN_PASSWORD || 'changeme');
  await page.getByRole('button', { name: 'Enter Dashboard' }).click();
}

test('picking a listed city writes it to the field the form submits', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/registrations/new');

  const picker = page.locator('[data-city-select]').first();
  const list = picker.locator('[data-city-list]');
  const other = picker.locator('[data-city-other]');

  await expect(list).toBeVisible();
  await expect(other).toBeHidden();

  await list.selectOption('Bengaluru');

  // The text input carries the id the submit handler reads, so a listed city
  // has to land there too, not only on the select.
  await expect(other).toHaveValue('Bengaluru');
  await expect(other).toBeHidden();
  expect(await page.evaluate(() => (document.getElementById('city') as HTMLInputElement).value)).toBe('Bengaluru');
});

test('"Other" reveals a text box and clears the previous pick', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/registrations/new');

  const picker = page.locator('[data-city-select]').first();
  const list = picker.locator('[data-city-list]');
  const other = picker.locator('[data-city-other]');

  await list.selectOption('Bengaluru');
  await list.selectOption('__other__');

  await expect(other).toBeVisible();
  // Cleared, so the listed city cannot be submitted under an "Other" label.
  await expect(other).toHaveValue('');

  await other.fill('Ziro');
  expect(await page.evaluate(() => (document.getElementById('city') as HTMLInputElement).value)).toBe('Ziro');
});

test('the state field is a list, not free text', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/registrations/new');

  const state = page.locator('#state');
  await expect(state).toBeVisible();
  expect(await state.evaluate((el) => el.tagName)).toBe('SELECT');
  await state.selectOption('Arunachal Pradesh');
  await expect(state).toHaveValue('Arunachal Pradesh');
});
