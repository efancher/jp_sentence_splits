import { expect, test, type Page } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

const WIDTHS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 800 },
];

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

for (const size of WIDTHS) {
  test.describe(`${size.name} width`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('Play hub on an empty library explains what each game needs, without overflow', async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto('/#/play');
      await expect(page.getByRole('heading', { name: 'Play', exact: true })).toBeVisible();
      await expect(page.getByText(/Not enough to play yet/).first()).toBeVisible();
      await expectNoHorizontalOverflow(page);
      expect(errors).toEqual([]);
    });

    test('unknown game id shows a way back to the hub', async ({ page }) => {
      await page.goto('/#/play/not-a-game/none');
      await expect(page.getByText('No such game.')).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.getByRole('link', { name: 'Back to games' }).click();
      await expect(page.getByRole('heading', { name: 'Play', exact: true })).toBeVisible();
    });
  });
}
