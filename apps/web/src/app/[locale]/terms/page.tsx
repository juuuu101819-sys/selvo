import type { Metadata } from 'next';
import { LegalDocument } from '@/components/legal-document';

export const metadata: Metadata = {
  title: 'Terms of use',
  description:
    'Draft terms of use for Meridian, a non-custodial route comparison hub. Not a binding contract. Meridian does not execute, settle, or custody funds.',
};

export default function TermsPage() {
  return (
    <LegalDocument title="Terms of use">
      <section className="space-y-2">
        <h2 className="text-base font-semibold tracking-tight">1. What Meridian is</h2>
        <p>
          Meridian is a non-custodial comparison layer. It ranks payment routes for businesses and
          for AI agents acting on behalf of an organization. You describe an amount and a currency
          pair; Meridian returns indicative all-in cost, fees, settlement time, slippage, a route
          score, and quote timing. It does not take custody of money, hold private keys or wallets,
          or move funds.
        </p>
      </section>
      <section className="space-y-2">
        <h2 className="text-base font-semibold tracking-tight">2. What Meridian is not</h2>
        <p>
          Meridian is not a bank, money transmitter, payment institution, foreign-exchange dealer,
          electronic-money or e-finance institution, virtual-asset service provider, exchange,
          licensed broker, custodian, or settlement provider. It is not a principal on any
          transaction. Licensed-partner adapters are not connected in this product. Quotes stay
          sandbox-labelled and non-binding.
        </p>
      </section>
      <section className="space-y-2">
        <h2 className="text-base font-semibold tracking-tight">3. No funds movement</h2>
        <p>
          Execution is not part of this product. Recording an execution intent, if offered, does
          not pay anyone. The platform refuses live execution rather than failing open. Meridian
          never moves, remits, settles, or executes customer funds. You transact with the provider
          you choose. If live settlement is ever offered, a licensed partner — not Meridian — would
          execute; no such partner adapter is connected today.
        </p>
      </section>
      <section className="space-y-2">
        <h2 className="text-base font-semibold tracking-tight">4. Quotes</h2>
        <p>
          Ranked routes are indicative estimates, not an offer, commitment, or guarantee. Sandbox
          pricing is synthetic reference data, not a committed market price. A quote may expire.
          Re-compare before you rely on a figure. Meridian does not guarantee that a provider will
          honour a displayed price.
        </p>
      </section>
      <section className="space-y-2">
        <h2 className="text-base font-semibold tracking-tight">5. Access</h2>
        <p>
          Organization accounts are invite-only for this cohort. There is no public signup.
          Organization API keys use the <code className="font-mono text-xs">mk_</code> prefix.
          Agent credentials use <code className="font-mono text-xs">mag_</code>. Keys are shown
          once, stored as hashes, and may be revoked. Rate limits apply. Accepting an invite does
          not verify KYB, attach pricing, or enable execution.
        </p>
      </section>
      <section className="space-y-2">
        <h2 className="text-base font-semibold tracking-tight">6. Charges</h2>
        <p>
          Meridian does not charge a percentage of customer transaction volume as a public
          take-rate. If a platform fee appears on a quote or invoice, it is a negotiated
          usage or subscription term for that organization. Invoices in this product are record-only;
          collection, subscriptions, and partner payouts are not live.
        </p>
      </section>
      <section className="space-y-2">
        <h2 className="text-base font-semibold tracking-tight">7. Acceptable use</h2>
        <p>
          Do not attempt to use Meridian to custody funds, bypass sanctions or KYB gates, scrape
          secrets from responses, or represent sandbox quotes as executable prices to an end
          customer. Operator kill switches may disable a corridor, provider, tenant, or region
          without notice.
        </p>
      </section>
      <section className="space-y-2">
        <h2 className="text-base font-semibold tracking-tight">8. Status of this draft</h2>
        <p>
          Counsel has not issued an in-force version. This draft may change. It creates no licence,
          warranty, indemnity, or governing-law election. When counsel publishes terms, those terms
          replace this page.
        </p>
      </section>
    </LegalDocument>
  );
}
