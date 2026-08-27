import { expect, test } from '@playwright/test';

/**
 * The one journey the product exists for: describe a transaction, get a best route with the
 * alternatives that justify it.
 *
 * Assertions go through accessible roles and visible text rather than CSS selectors, so the suite
 * survives styling changes and fails only when the behaviour a user relies on actually breaks.
 */
test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('compares routes for the worked example, best route first', async ({ page }) => {
  await expect(page.getByRole('heading', { name: /Find the best financial route/i })).toBeVisible();
  await expect(page.getByText('No comparison yet')).toBeVisible();

  await page.getByRole('button', { name: /Compare routes/i }).click();

  const results = page.getByRole('region', { name: /Route comparison results/i });
  await expect(results).toBeVisible();

  // Hierarchy: the best route leads, alternatives follow, then the cost comparison.
  const best = page.getByRole('article', { name: /Best route/i });
  await expect(best).toBeVisible();
  await expect(best).toContainText('Solstice Settlement');
  await expect(best).toContainText('0.34%');

  const alternatives = page.getByRole('region', { name: /Alternative routes/i });
  await expect(alternatives.locator('article')).toHaveCount(3);
  await expect(alternatives).not.toContainText('Recommended');
  await expect(alternatives.locator('article').last()).toContainText('Northgate Bank');
  await expect(alternatives.locator('article').last()).toContainText('0.72%');

  await expect(page.getByRole('region', { name: /Cost comparison/i })).toBeVisible();
});

test('shows every figure needed to act, without expanding anything', async ({ page }) => {
  await page.getByRole('button', { name: /Compare routes/i }).click();
  const best = page.getByRole('article', { name: /Best route/i });

  // The brief's field list for the best route, verbatim.
  await expect(best).toContainText('Exchange rate');
  await expect(best).toContainText('Provider fee');
  await expect(best).toContainText('Platform fee');
  await expect(best).toContainText('Estimated total cost');
  await expect(best).toContainText('Beneficiary receives');
  await expect(best).toContainText('Settlement time');
  await expect(best).toContainText('Quote expires');
  await expect(best.getByText(/Quote valid/)).toBeVisible();
});

test('shows a cost breakdown that names where the money went', async ({ page }) => {
  await page.getByRole('button', { name: /Compare routes/i }).click();

  const best = page.getByRole('article', { name: /Best route/i });
  await best.getByRole('button', { name: /Show route details/i }).click();

  for (const row of ['FX spread', 'Sending fees', 'Receiving fees', 'Expected slippage']) {
    await expect(best.getByRole('rowheader', { name: new RegExp(row) })).toBeVisible();
  }
  await expect(best.getByRole('rowheader', { name: 'Total cost' })).toBeVisible();
  await expect(best.getByText(/Pricing version/i)).toBeVisible();
});

test('offers the partner hand-off and never an execute button', async ({ page }) => {
  await page.getByRole('button', { name: /Compare routes/i }).click();

  // No control anywhere implies Meridian moves money.
  await expect(page.getByRole('button', { name: /^Execute/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Send money/i })).toHaveCount(0);

  const best = page.getByRole('article', { name: /Best route/i });
  await best.getByRole('button', { name: /Continue with partner/i }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(/Transact directly with Solstice Settlement/i);
  await expect(dialog).toContainText(/does not hold funds/i);
  // Both the footer button and the corner X are named Close; the footer one is first in the DOM.
  await dialog.getByRole('button', { name: /Close/i }).first().click();
  await expect(dialog).not.toBeVisible();
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
  const best = page.getByRole('article', { name: /Best route/i });

  await expect(best).toContainText('Recommended');
  await expect(best).toContainText('score 100');
  // Zero-weight factors are omitted from the footer rather than rendered as noise.
  await expect(results).toContainText('cost 1');
  await expect(results.locator('footer')).not.toContainText('speed');
});

test('prioritises settlement time when asked to optimise for speed', async ({ page }) => {
  await page.getByRole('button', { name: 'Fastest settlement' }).click();
  await page.getByRole('button', { name: /Compare routes/i }).click();

  const best = page.getByRole('article', { name: /Best route/i });
  await expect(best).toContainText('Solstice Settlement');
  await expect(best).toContainText('5 min');
});

test('restricts the comparison to a selected rail', async ({ page }) => {
  await page.getByRole('button', { name: 'Bank FX', exact: true }).click();
  await page.getByRole('button', { name: /Compare routes/i }).click();

  const best = page.getByRole('article', { name: /Best route/i });
  await expect(best).toContainText('Northgate Bank');
  // A single route needs no alternatives section and no comparison chart.
  await expect(page.getByRole('region', { name: /Alternative routes/i })).toHaveCount(0);
  await expect(page.getByRole('region', { name: /Cost comparison/i })).toHaveCount(0);
});

test('explains an amount that no provider will price', async ({ page }) => {
  const amount = page.getByLabel('You send');
  await amount.fill('1');
  await page.getByRole('button', { name: /Compare routes/i }).click();

  // Scoped to main: Next.js keeps a live route announcer with role="alert" outside it.
  const alert = page.getByRole('main').getByRole('alert');
  await expect(alert).toContainText('No provider will price this');
  await expect(alert).not.toContainText('No route for this corridor');
  await expect(alert).toContainText('1.00 USD');
  await expect(alert).toContainText(/outside every provider/i);
});

test('adapts amount validation to the selected currency', async ({ page }) => {
  await page.getByRole('button', { name: /Swap currencies/i }).click();

  await expect(page.getByText(/KRW has no minor unit/i)).toBeVisible();

  await page.getByLabel('You send').fill('138000000');
  await page.getByRole('button', { name: /Compare routes/i }).click();

  await expect(page.getByRole('region', { name: /Route comparison results/i })).toBeVisible();
});

test('states the non-custodial position on the page', async ({ page }) => {
  await expect(page.getByText(/Meridian is non-custodial/i)).toBeVisible();
  await expect(page.getByText(/never holds customer funds/i)).toBeVisible();
});
