import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { fetchMeta } from '@/lib/api/client';
import { InviteForm } from './invite-form';

export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const meta = await fetchMeta();

  return (
    <>
      <SiteHeader
        mode={meta.ok ? meta.data.mode : null}
        engineVersion={meta.ok ? meta.data.engineVersion : null}
      />
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-10 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Accept organization invite</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Meridian is invite-only for this cohort. An operator creates the organization and issues
          the first owner invite. Accepting sets your password; it does not verify KYB, attach
          pricing, or enable execution.
        </p>
        <div className="mt-6">
          <InviteForm initialToken={token ?? ''} />
        </div>
      </main>
      <SiteFooter notice="Accepting an invite sets a password. It does not verify KYB, attach pricing, enable execution, or move funds." />
    </>
  );
}
