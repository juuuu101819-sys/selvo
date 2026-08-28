import { redirect } from 'next/navigation';
import { LoginForm } from '@/app/login/login-form';
import { SiteHeader } from '@/components/site-header';
import { fetchMe, fetchMeta } from '@/lib/api/client';
import { DEMO_LOGIN } from '@/lib/demo-credentials';
import { readSessionToken, safeDashboardPath } from '@/lib/session';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const nextPath = safeDashboardPath(next);
  const token = await readSessionToken();
  if (token !== null) {
    const me = await fetchMe(token);
    if (me.ok) {
      redirect(nextPath);
    }
  }

  const meta = await fetchMeta();
  const allowDemoCredentials = meta.ok && meta.data.mode === 'sandbox';

  return (
    <>
      <SiteHeader
        mode={meta.ok ? meta.data.mode : null}
        engineVersion={meta.ok ? meta.data.engineVersion : null}
      />
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-10 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Organization sign in</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          The dashboard shows quotes, transactions and savings for your organization only. Public
          route comparison stays available without an account.
        </p>
        <div className="mt-6">
          <LoginForm nextPath={nextPath} allowDemoCredentials={allowDemoCredentials} />
        </div>
        {allowDemoCredentials ? (
          <aside className="border-border/60 bg-muted/40 mt-8 rounded-xl border p-4 text-sm">
            <h2 className="font-medium">Local demo tenant</h2>
            <p className="text-muted-foreground mt-1">
              Sandbox only. This login is committed on purpose so local development does not need a
              secrets manager.
            </p>
            <dl className="mt-3 space-y-1 font-mono text-xs">
              <div>
                <dt className="text-muted-foreground inline">email </dt>
                <dd className="inline">{DEMO_LOGIN.email}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground inline">password </dt>
                <dd className="inline">{DEMO_LOGIN.password}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground inline">organization </dt>
                <dd className="inline">{DEMO_LOGIN.organization}</dd>
              </div>
            </dl>
          </aside>
        ) : null}
      </main>
    </>
  );
}
