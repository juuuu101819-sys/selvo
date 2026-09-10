import { getTranslations } from 'next-intl/server';
import { RouteExplorer } from '@/components/route-explorer';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { fetchMeta } from '@/lib/api/client';

export default async function RailsPage() {
  const meta = await fetchMeta();
  const t = await getTranslations('pages');
  const tFooter = await getTranslations('footer');

  return (
    <>
      <SiteHeader
        mode={meta.ok ? meta.data.mode : null}
        engineVersion={meta.ok ? (meta.data.routingEngineVersion ?? meta.data.engineVersion) : null}
      />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        <div className="mb-8 max-w-2xl">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t('railsTitle')}</h1>
          <p className="text-muted-foreground mt-2 text-sm sm:text-base">{t('railsLede')}</p>
        </div>
        <RouteExplorer />
      </main>
      <SiteFooter notice={tFooter('railsNotice')} />
    </>
  );
}
