import { describe, expect, it } from 'vitest';
import { PersistenceError } from '../errors/index.js';
import { FailingKybVendor, ManualReviewKybVendor } from './kyb-vendor.js';

describe('KYB vendor fail-closed', () => {
  it('manual review submits pending and never verifies', async () => {
    const vendor = new ManualReviewKybVendor();
    const result = await vendor.submitForReview({
      organizationId: 'org_x',
      countryCode: 'SG',
    });
    expect(result.status).toBe('pending');
    expect(result.vendorId).toBe('manual_review');
  });

  it('a vendor error does not produce a verified status', async () => {
    const vendor = new FailingKybVendor();
    await expect(
      vendor.submitForReview({ organizationId: 'org_x', countryCode: 'SG' }),
    ).rejects.toThrow(PersistenceError);
  });
});
