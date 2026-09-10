import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { LegalDocument } from '@/components/legal-document';

export const metadata: Metadata = {
  title: 'Privacy',
  description:
    'Draft privacy disclosure for Meridian. Comparison requests are an amount and a currency pair. Not an in-force privacy notice.',
};

export default async function PrivacyPage() {
  const t = await getTranslations('legal');
  return (
    <LegalDocument title={t('privacyTitle')}>
      <section className="space-y-2">
        <h2 className="text-base font-semibold tracking-tight">1. Status</h2>
        <p>
          This is a product disclosure, not an in-force privacy policy, DPIA, or GDPR Article 13/14
          notice. Counsel must replace it before it is represented as binding. Meridian does not
          invent a legal entity, data-protection officer, or supervisory authority on this page.
        </p>
      </section>
      <section className="space-y-2">
        <h2 className="text-base font-semibold tracking-tight">2. What a comparison contains</h2>
        <p>
          A route comparison is an amount, a currency pair, and optional scoring weights. The
          comparison and quote schemas reject unknown fields, so beneficiary names, account
          numbers, and identity documents cannot be smuggled into those requests. Sandbox quotes
          are synthetic reference data.
        </p>
      </section>
      <section className="space-y-2">
        <h2 className="text-base font-semibold tracking-tight">3. Accounts and credentials</h2>
        <p>
          Invite-only organization accounts store an email and a password hash for the owner who
          accepts the invite. API keys and agent credentials are stored as salted hashes; the
          secret is shown once. Session cookies are httpOnly, SameSite=Lax, and Secure in
          production. The cookie is not readable from JavaScript and is not used for advertising.
        </p>
      </section>
      <section className="space-y-2">
        <h2 className="text-base font-semibold tracking-tight">4. Audit trail</h2>
        <p>
          Financially meaningful events are appended to an organization-scoped audit log (for
          example comparison requested, key issued, kill switch engaged). The log has no update or
          delete operation. Export is limited to owner or admin sessions of that organization.
          Audit payloads are not a place we store raw passwords or API secrets.
        </p>
      </section>
      <section className="space-y-2">
        <h2 className="text-base font-semibold tracking-tight">5. What we do not hold</h2>
        <p>
          Meridian does not hold customer funds, private keys, or wallets. It does not open an RPC
          or chain connection to take custody of a token. Wallet references on agent intents are
          external handles; the platform does not control them. Signed mandates may list
          beneficiary codes as authorization constraints — that is not an account number Meridian
          pays.
        </p>
        <p>
          Meridian does not move, remit, settle, or execute transfers of customer funds. It is not
          a bank, money transmitter, payment institution, foreign-exchange dealer, electronic-money
          or e-finance institution, or virtual-asset service provider. Quotes shown in the product
          are indicative estimates, not an offer or guarantee. If live settlement is ever offered,
          a licensed partner would execute; licensed-partner adapters are not connected in this
          product.
        </p>
      </section>
      <section className="space-y-2">
        <h2 className="text-base font-semibold tracking-tight">6. Sharing</h2>
        <p>
          We do not sell personal data. Licensed-partner adapters are not connected in this
          product. Request logs redact authorization headers, cookies, passwords, tokens, wallets,
          and private keys. Public error responses do not include stack traces or datastore detail.
        </p>
      </section>
      <section className="space-y-2">
        <h2 className="text-base font-semibold tracking-tight">7. Retention</h2>
        <p>
          Comparison, quote, and audit records persist so a historical price can be explained. This
          draft does not set a statutory retention period. When counsel issues an in-force notice,
          retention and deletion rights belong there.
        </p>
      </section>
    </LegalDocument>
  );
}
