import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { LoginForm } from './login-form';
import { SiteFooter } from '@/components/site-footer';
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
  const t = await getTranslations('login');
  const tFooter = await getTranslations('footer');
  const allowDemoCredentials = meta.ok && meta.data.mode === 'sandbox';

  return (
    <>
      <SiteHeader
        mode={meta.ok ? meta.data.mode : null}
        engineVersion={meta.ok ? meta.data.engineVersion : null}
      />
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-10 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground mt-2 text-sm">{t('lede')}</p>
        <div className="mt-6">
          <LoginForm nextPath={nextPath} allowDemoCredentials={allowDemoCredentials} />
        </div>
        {allowDemoCredentials ? (
          <aside className="border-border/60 bg-muted/40 mt-8 rounded-xl border p-4 text-sm">
            <h2 className="font-medium">{t('demoTitle')}</h2>
            <p className="text-muted-foreground mt-1">{t('demoBody')}</p>
            <dl className="mt-3 space-y-1 font-mono text-xs">
              <div>
                <dt className="text-muted-foreground inline">{t('demoEmail')} </dt>
                <dd className="inline">{DEMO_LOGIN.email}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground inline">{t('demoPassword')} </dt>
                <dd className="inline">{DEMO_LOGIN.password}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground inline">{t('demoOrganization')} </dt>
                <dd className="inline">{DEMO_LOGIN.organization}</dd>
              </div>
            </dl>
          </aside>
        ) : null}
      </main>
      <SiteFooter notice={tFooter('loginNotice')} />
    </>
  );
}
