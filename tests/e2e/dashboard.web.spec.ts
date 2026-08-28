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

test('redirects an anonymous visitor from the dashboard to sign in', async ({ page }) => {
  await page.goto('/dashboard/quotes');
  await expect(page.getByRole('heading', { name: /Organization sign in/i })).toBeVisible();
});

test('rejects the wrong password without leaking whether the email exists', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Work email').fill(DEMO_EMAIL);
  await page.getByLabel('Password').fill('definitely-wrong-pass');
  await page
    .locator('form')
    .getByRole('button', { name: /^Sign in$/i })
    .click();

  const alert = page.getByRole('main').getByRole('alert');
  await expect(alert).toContainText(/Email or password is incorrect/i);
  await expect(page).toHaveURL(/\/login/);
});

test('opens the organization dashboard from the documented demo login', async ({ page }) => {
  await signIn(page);

  await expect(page.getByText('Meridian Demo Trading Co').first()).toBeVisible();
  await expect(page.getByRole('region', { name: /Dashboard metrics/i })).toBeVisible();
  await expect(page.getByText('Total quoted volume')).toBeVisible();
  await expect(page.getByText('Estimated savings')).toBeVisible();
  await expect(page.getByText('Successful route requests')).toBeVisible();
  await expect(page.getByText('Average route cost')).toBeVisible();
  await expect(page.getByText('Average settlement estimate')).toBeVisible();

  await expect(page.getByRole('region', { name: /Quoted volume by day/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Execute/i })).toHaveCount(0);
});

test("lists this organization quotes and never another tenant's reference", async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Quotes' }).click();

  await expect(page.getByRole('heading', { name: /^Quotes$/i })).toBeVisible();
  await expect(page.getByText('Solstice Settlement').first()).toBeVisible();
  await expect(page.getByText('OTHER-SHOULD-NOT-LEAK')).toHaveCount(0);
  await expect(page.getByText('ops@acme-other.example.invalid')).toHaveCount(0);
  await expect(page.getByText('org_acme_other')).toHaveCount(0);
});

test('lists this organization transactions and not the isolation tenant', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Transactions' }).click();

  await expect(page.getByRole('heading', { name: /Transactions/i })).toBeVisible();
  await expect(page.getByText('DEMO-PO-4417')).toBeVisible();
  await expect(page.getByText('OTHER-SHOULD-NOT-LEAK')).toHaveCount(0);
});

test('shows provider usage computed from stored quotes', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Providers' }).click();

  await expect(page.getByRole('heading', { name: /Providers/i })).toBeVisible();
  await expect(page.getByText('Northgate Bank')).toBeVisible();
});

test("settings list only this organization's members and never API secrets", async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Settings' }).click();

  await expect(page.getByRole('heading', { name: /Organization settings/i })).toBeVisible();
  await expect(page.getByText(DEMO_EMAIL)).toBeVisible();
  await expect(page.getByText('ops@acme-other.example.invalid')).toHaveCount(0);
  await expect(page.getByText('MeridianDemo!2026')).toHaveCount(0);
});

test('invoices page starts empty and never claims cash was collected', async ({ page }) => {
  await signIn(page);
  await page.getByRole('navigation', { name: /Organization dashboard/i }).getByRole('link', { name: 'Invoices' }).click();

  await expect(page.getByRole('heading', { name: /^Invoices$/i })).toBeVisible();
  await expect(page.getByText('No invoices issued yet')).toBeVisible();
  await expect(page.getByText(/payment collection is deferred/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Execute/i })).toHaveCount(0);
});

test('onboarding checklist reflects live unverified demo-tenant state', async ({ page }) => {
  await signIn(page);
  await page.getByRole('navigation', { name: /Organization dashboard/i }).getByRole('link', { name: 'Onboarding' }).click();

  await expect(page.getByRole('heading', { name: /Organization onboarding/i })).toBeVisible();
  await expect(page.getByText('Not eligible for licensed quotes')).toBeVisible();
  await expect(page.getByText('sales_assisted_invite_only')).toBeVisible();
  await expect(page.getByText('manual_review')).toBeVisible();
  await expect(page.getByText('No CustomerPricing row. There is no silent default take-rate.')).toBeVisible();
  await expect(page.getByText('Licensed quoting is still blocked at the platform')).toBeVisible();
  await expect(page.getByRole('button', { name: /Submit for KYB review/i })).toBeVisible();
});

test('invite acceptance page is public', async ({ page }) => {
  await page.goto('/invite');
  await expect(page.getByRole('heading', { name: /Accept organization invite/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Execute/i })).toHaveCount(0);
});

test('public route comparison still works without signing in', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Find the best financial route/i })).toBeVisible();
  await page.getByRole('button', { name: /Compare routes/i }).click();
  await expect(page.getByRole('region', { name: /Route comparison results/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Execute/i })).toHaveCount(0);
});
