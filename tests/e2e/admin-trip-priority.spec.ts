import { expect, test } from '@playwright/test';

test('priority dropdown reports saves and rolls back a failed change without reordering', async ({ page }) => {
  await page.goto('/admin/login');
  await page.getByText('Password fallback').click();
  await page.getByPlaceholder('Admin password').fill(process.env.ADMIN_PASSWORD || 'changeme');
  await page.getByRole('button', { name: 'Enter Dashboard' }).click();
  await page.goto('/admin/trips');

  const selects = page.locator('.trip-priority:visible');
  const select = selects.first();
  await expect(select).toBeVisible();
  const original = await select.inputValue();
  const successValue = original === 'high' ? 'medium' : 'high';
  const failureValue = successValue === 'low' ? 'medium' : 'low';
  const cardOrder = await selects.evaluateAll((items) => items.map((item) => (item as HTMLSelectElement).dataset.slug));

  let requestCount = 0;
  await page.route('**/api/admin/trips/priority', async (route) => {
    requestCount++;
    if (requestCount === 1) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, priority: successValue }) });
    } else {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false }) });
    }
  });

  await select.selectOption(successValue);
  await expect(select.locator('xpath=..').locator('.priority-state')).toHaveText('Saved');
  await expect(select).toBeEnabled();
  expect(await selects.evaluateAll((items) => items.map((item) => (item as HTMLSelectElement).dataset.slug))).toEqual(cardOrder);

  await select.selectOption(failureValue);
  await expect(select.locator('xpath=..').locator('.priority-state')).toHaveText('Try again');
  await expect(select).toHaveValue(successValue);
  await expect(select).toBeEnabled();
});
