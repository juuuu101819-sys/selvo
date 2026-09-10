import { expect, test } from '@playwright/test';

test('keeps English as the unprefixed canonical locale', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(
    page.getByRole('heading', { name: /Rank payment routes for businesses and AI agents/i }),
  ).toBeVisible();
  await expect(page.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveCount(1);
  await expect(page.locator('link[rel="alternate"][hreflang="ko"]')).toHaveCount(1);
});

test('serves a locale prefix with matching html lang', async ({ page }) => {
  await page.goto('/ko');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
  await expect(page).toHaveURL(/\/ko\/?$/);
  await expect(
    page.getByRole('heading', { name: /Rank payment routes for businesses and AI agents/i }),
  ).toBeVisible();
  await expect(page.getByRole('navigation', { name: /Legal/i })).toBeVisible();
});

test('language switcher prefixes the path and stores meridian_locale', async ({ page, context }) => {
  await page.goto('/');
  await page.getByLabel('Language').selectOption('ko');
  await expect(page).toHaveURL(/\/ko\/?$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
  const cookies = await context.cookies();
  expect(cookies.some((cookie) => cookie.name === 'meridian_locale' && cookie.value === 'ko')).toBe(
    true,
  );
});

test('redirects Accept-Language Japanese to /ja', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'ja-JP' });
  const page = await context.newPage();
  try {
    await page.goto('/');
    await expect(page).toHaveURL(/\/ja\/?$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  } finally {
    await context.close();
  }
});
