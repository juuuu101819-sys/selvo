import { getTranslations } from 'next-intl/server';
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
  const t = await getTranslations('invite');
  const tFooter = await getTranslations('footer');

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
          <InviteForm initialToken={token ?? ''} />
        </div>
      </main>
      <SiteFooter notice={tFooter('inviteNotice')} />
    </>
  );
}
