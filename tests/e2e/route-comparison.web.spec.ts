import { expect, test } from '@playwright/test';

/**
 * The one journey the product exists for: describe a transaction, get ranked routes.
 *
 * Assertions go through accessible roles and visible text rather than CSS selectors, so the suite
 * survives styling changes and fails only when the behaviour a user relies on actually breaks.
 */
test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('compares routes for the worked example and recommends the best one', async ({ page }) => {
  await expect(page.getByRole('heading', { name: /Find the best financial route/i })).toBeVisible();
  await expect(page.getByText('No comparison yet')).toBeVisible();

  await page.getByRole('button', { name: /Compare routes/i }).click();

  const results = page.getByRole('region', { name: /Route comparison results/i });
  await expect(results).toBeVisible();

  // Four sandbox rails price USD/KRW.
  const routeCards = results.locator('article');
  await expect(routeCards).toHaveCount(4);

  await expect(page.getByText('Recommended route')).toBeVisible();
  await expect(results.getByText('Solstice Settlement').first()).toBeVisible();

  // The bank route is the most expensive, so it ranks last.
  await expect(routeCards.last()).toContainText('Northgate Bank');
  await expect(routeCards.first()).toContainText('0.34%');
  await expect(routeCards.last()).toContainText('0.72%');
});

test('shows a cost breakdown that names where the money went', async ({ page }) => {
  await page.getByRole('button', { name: /Compare routes/i }).click();

  const firstCard = page
    .getByRole('region', { name: /Route comparison results/i })
    .locator('article')
    .first();
  await firstCard.getByRole('button', { name: /Show cost breakdown/i }).click();

  // Addressed as row headers: the card also carries a "total cost" caption above the percentage,
  // so plain text matching is ambiguous.
  for (const row of ['FX spread', 'Sending fees', 'Receiving fees', 'Expected slippage']) {
    await expect(firstCard.getByRole('rowheader', { name: new RegExp(row) })).toBeVisible();
  }
  await expect(firstCard.getByRole('rowheader', { name: 'Total cost' })).toBeVisible();
  await expect(firstCard.getByText(/Pricing version/i)).toBeVisible();
});

test('verifies that a stored comparison replays to the same result', async ({ page }) => {
  await page.getByRole('button', { name: /Compare routes/i }).click();
  await page.getByRole('button', { name: /Verify reproducibility/i }).click();

  await expect(page.getByText(/Replayed to an identical result and fingerprint/i)).toBeVisible();
});

test('scores purely on cost when asked to optimise for cost', async ({ page }) => {
  await page.getByRole('button', { name: 'Lowest cost' }).click();
  await page.getByRole('button', { name: /Compare routes/i }).click();

  const results = page.getByRole('region', { name: /Route comparison results/i });
  const firstCard = results.locator('article').first();

  // With all the weight on cost, the cheapest route is by definition a perfect score.
  await expect(firstCard).toContainText('Recommended');
  await expect(firstCard.getByRole('meter', { name: /Route score/i })).toHaveAttribute(
    'aria-valuenow',
    '100',
  );
  await expect(results).toContainText('cost 1 · speed 0 ·');
});

test('prioritises settlement time when asked to optimise for speed', async ({ page }) => {
  await page.getByRole('button', { name: 'Fastest settlement' }).click();
  await page.getByRole('button', { name: /Compare routes/i }).click();

  const firstCard = page
    .getByRole('region', { name: /Route comparison results/i })
    .locator('article')
    .first();

  // The stablecoin rail settles in five minutes, an order of magnitude faster than the rest.
  await expect(firstCard).toContainText('Solstice Settlement');
  await expect(firstCard).toContainText('5 min');
});

test('restricts the comparison to a selected rail', async ({ page }) => {
  await page.getByRole('button', { name: 'Bank FX', exact: true }).click();
  await page.getByRole('button', { name: /Compare routes/i }).click();

  const routeCards = page
    .getByRole('region', { name: /Route comparison results/i })
    .locator('article');
  await expect(routeCards).toHaveCount(1);
  await expect(routeCards.first()).toContainText('Northgate Bank');
});

test('explains an amount that no provider will price', async ({ page }) => {
  const amount = page.getByLabel('You send');
  await amount.fill('1');
  await page.getByRole('button', { name: /Compare routes/i }).click();

  // Scoped to main: Next.js keeps a live route announcer with role="alert" outside it.
  const alert = page.getByRole('main').getByRole('alert');
  await expect(alert).toContainText('1.00 USD');
  await expect(alert).toContainText(/outside every provider/i);
});

test('adapts amount validation to the selected currency', async ({ page }) => {
  await page.getByRole('button', { name: /Swap currencies/i }).click();

  // The won has no minor unit, so the form says so and the API rejects a fractional amount.
  await expect(page.getByText(/KRW has no minor unit/i)).toBeVisible();

  await page.getByLabel('You send').fill('138000000');
  await page.getByRole('button', { name: /Compare routes/i }).click();

  await expect(page.getByRole('region', { name: /Route comparison results/i })).toBeVisible();
});

test('states the non-custodial position on the page', async ({ page }) => {
  await expect(page.getByText(/Meridian is non-custodial/i)).toBeVisible();
  await expect(page.getByText(/never holds customer funds/i)).toBeVisible();
});
