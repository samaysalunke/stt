import { expect, test } from '@playwright/test';

test.describe('trip description editor', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin/login');
    await page.getByText('Password fallback').click();
    await page.getByPlaceholder('Admin password').fill(process.env.ADMIN_PASSWORD || 'changeme');
    await page.getByRole('button', { name: 'Enter Dashboard' }).click();
    await expect(page).toHaveURL(/\/admin\/$/);
  });

  test('loads plain text and synchronizes supported formatting as Markdown', async ({ page }) => {
    await page.goto('/admin/trips/qa-test-bookable');
    await page.getByRole('button', { name: 'Content', exact: true }).click();
    const editor = page.locator('[data-rich-text-editor]');
    const surface = editor.locator('[contenteditable="true"]');
    const markdown = editor.locator('textarea[name="description"]');

    await expect(editor).toHaveAttribute('data-enhanced', 'true');
    await expect(surface).toContainText('Automated QA fixture trip. Do not delete.');
    await expect(markdown).toHaveValue('Automated QA fixture trip. Do not delete.');

    const formatAll = async (text: string, command: string) => {
      await surface.fill(text);
      await surface.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
      await editor.locator(`[data-command="${command}"]`).click();
    };

    await formatAll('Section title', 'heading-2');
    await expect(markdown).toHaveValue(/## Section title/);
    await formatAll('Smaller title', 'heading-3');
    await expect(markdown).toHaveValue(/### Smaller title/);
    await formatAll('Bold copy', 'bold');
    await expect(markdown).toHaveValue(/\*\*Bold copy\*\*/);
    await formatAll('Italic copy', 'italic');
    await expect(markdown).toHaveValue(/_Italic copy_|\*Italic copy\*/);
    await formatAll('Bulleted item', 'bullet-list');
    await expect(markdown).toHaveValue(/^- .*Bulleted item/m);
    await formatAll('Numbered item', 'ordered-list');
    await expect(markdown).toHaveValue(/^1\. .*Numbered item/m);

    await surface.fill('External link');
    await surface.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
    page.once('dialog', (dialog) => dialog.accept('example.com/details'));
    await editor.locator('[data-command="link"]').click();
    await expect(markdown).toHaveValue(/External link.*\]\(https:\/\/example\.com\/details\)/);

    await surface.fill('Undo me');
    await editor.locator('[data-command="undo"]').click();
    await expect(markdown).not.toHaveValue(/Undo me/);
    await editor.locator('[data-command="redo"]').click();
    await expect(markdown).toHaveValue(/Undo me/);
  });
});
