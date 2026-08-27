import { expect, test, type Page } from '@playwright/test';

const DEMO_EMAIL = 'treasury@demo-trading.example.invalid';

async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByRole('button', { name: /Use demo credentials/i }).click();
  await page
    .locator('form')
    .getByRole('button', { name: /^Sign in$/i })
    .click();
  await expect(page.getByRole('heading', { name: /Organization overview/i })).toBeVisible();
}

test('opens the AI agent financial dashboard without an execute control', async ({ page }) => {
  await signIn(page);
  await page.goto('/dashboard/agents');

  await expect(page.getByRole('heading', { name: /AI agent financial dashboard/i })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Demo Treasury Agent' })).toBeVisible();
  await expect(page.getByText('agt_demo_treasury').first()).toBeVisible();
  const demoRow = page.locator('tr').filter({ hasText: 'agt_demo_treasury' }).first();
  await expect(demoRow).toContainText(/[\d,]+\.\d{2} USD/);
  await expect(page.getByRole('button', { name: /^Execute/i })).toHaveCount(0);
  await expect(page.getByText('pay_other_secret')).toHaveCount(0);
  await expect(page.getByText('99999900')).toHaveCount(0);
  await expect(page.getByText(DEMO_EMAIL)).toHaveCount(0);
});
