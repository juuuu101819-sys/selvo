import { expect, test } from '@playwright/test';

/**
 * Mobile layout checks.
 *
 * Horizontal overflow is asserted numerically rather than judged from a screenshot, so a regression
 * fails the build instead of waiting for someone to notice a stray scrollbar.
 */
test('renders the comparison flow without horizontal overflow', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: /Find the best financial route/i })).toBeVisible();

  await page.getByRole('button', { name: /Compare routes/i }).click();
  await expect(page.getByRole('region', { name: /Route comparison results/i })).toBeVisible();

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));

  // A single pixel of tolerance for sub-pixel rounding in the layout engine.
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
});

test('keeps the form and route cards reachable on a narrow viewport', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByLabel('You send')).toBeVisible();
  await expect(page.getByRole('button', { name: /Compare routes/i })).toBeVisible();

  await page.getByRole('button', { name: /Compare routes/i }).click();

  const routeCards = page
    .getByRole('region', { name: /Route comparison results/i })
    .locator('article');
  await expect(routeCards.first()).toBeVisible();
  await expect(routeCards.last()).toBeVisible();
});
