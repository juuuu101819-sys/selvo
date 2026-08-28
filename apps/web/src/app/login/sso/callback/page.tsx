import { SsoCallbackClient } from '@/app/login/sso/callback/sso-callback-client';
import { SiteHeader } from '@/components/site-header';
import { fetchMeta } from '@/lib/api/client';
import { safeDashboardPath } from '@/lib/session';

export default async function SsoCallbackPage({
  searchParams,
}: {
  searchParams: Promise<{
    code?: string;
    state?: string;
    error?: string;
    error_description?: string;
    next?: string;
  }>;
}) {
  const params = await searchParams;
  const meta = await fetchMeta();

  return (
    <>
      <SiteHeader
        mode={meta.ok ? meta.data.mode : null}
        engineVersion={meta.ok ? meta.data.engineVersion : null}
      />
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-10 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Organization SSO</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Completing federated sign-in. A session is issued only for an existing organization
          member — unmapped identities are rejected.
        </p>
        <div className="mt-6">
          <SsoCallbackClient
            code={params.code ?? null}
            state={params.state ?? null}
            nextPath={safeDashboardPath(params.next)}
            errorDescription={
              params.error_description ??
              (params.error !== undefined ? 'The identity provider rejected the sign-in.' : null)
            }
          />
        </div>
      </main>
    </>
  );
}
