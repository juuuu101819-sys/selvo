import { expect, test } from '@playwright/test';

test('footer links to draft terms and privacy pages', async ({ page }) => {
  await page.goto('/');

  const legal = page.getByRole('navigation', { name: /Legal/i });
  await expect(legal.getByRole('link', { name: /Terms of use/i })).toBeVisible();
  await expect(legal.getByRole('link', { name: /Privacy/i })).toBeVisible();

  await legal.getByRole('link', { name: /Terms of use/i }).click();
  await expect(page.getByRole('heading', { name: /Terms of use/i })).toBeVisible();
  await expect(page.getByText(/not a binding contract/i)).toBeVisible();
  await expect(page.getByText(/Draft · not in force/i)).toBeVisible();
  await expect(page.getByText(/does not take custody of money, hold private keys or wallets/i)).toBeVisible();
  await expect(page.getByText(/not an offer, commitment, or guarantee/i)).toBeVisible();
  await expect(page.getByText(/does not charge a percentage of customer transaction volume/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Execute/i })).toHaveCount(0);

  await page.getByRole('navigation', { name: /Legal/i }).getByRole('link', { name: /^Privacy$/i }).click();
  await expect(page.getByRole('heading', { name: /^Privacy$/i })).toBeVisible();
  await expect(page.getByText(/not an in-force privacy policy/i)).toBeVisible();
  await expect(page.getByText(/does not hold customer funds, private keys, or wallets/i)).toBeVisible();
  await expect(page.getByText(/does not move, remit, settle, or execute transfers of customer funds/i)).toBeVisible();
});

test('serves a favicon and an open-graph image', async ({ page, request }) => {
  await page.goto('/');

  const iconHref = await page.locator('link[rel="icon"]').first().getAttribute('href');
  expect(iconHref).toBeTruthy();
  const iconResponse = await request.get(new URL(iconHref ?? '', page.url()).toString());
  expect(iconResponse.ok()).toBe(true);

  const ogImage = await page.locator('meta[property="og:image"]').first().getAttribute('content');
  expect(ogImage).toBeTruthy();
  const ogResponse = await request.get(ogImage ?? '');
  expect(ogResponse.ok()).toBe(true);
  expect(ogResponse.headers()['content-type']).toMatch(/image\//);
});
