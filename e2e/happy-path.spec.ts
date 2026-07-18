import { expect, test } from '@playwright/test';
import path from 'node:path';

const fixture = path.resolve('fixtures/little-birds.csv');

test('import, book, analyze, reload, backup', async ({ page }) => {
  test.setTimeout(90_000);

  await page.goto('/#/import');
  await page.setInputFiles('input[type="file"]', fixture);
  await expect(page.getByText('Import preview')).toBeVisible();
  await page.getByLabel('Place selected sentences').selectOption('new_book');
  await page.getByRole('button', { name: /Import .* selected/ }).click();
  await expect(page.getByRole('button', { name: 'Edit order' })).toBeVisible();

  await page.getByRole('button', { name: 'Edit order' }).click();
  await page.getByRole('button', { name: 'Down' }).first().click();
  await expect(page.getByText('Order updated')).toBeVisible();
  await page.getByRole('button', { name: 'Done ordering' }).click();

  await page.getByRole('button', { name: 'Analyze' }).first().click();
  await page.getByRole('button', { name: 'Apply heuristic chunking' }).click();

  const role = page.getByLabel('Role').first();
  await expect(role).toBeVisible();
  await role.selectOption('modifier/content');
  await page.getByLabel('Literal sticky English').first().fill("sticky-english");
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/Saved|Saving/)).toBeVisible();

  await page.reload();
  await expect(
    page.locator('select').filter({ has: page.locator('option[value="modifier/content"]') }).first(),
  ).toHaveValue('modifier/content');
  await expect(page.locator('textarea').filter({ hasText: 'sticky-english' })).toBeVisible();

  await page.goto('/#/settings');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export all data' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/backup.*\.json$/);
});
