import { getTranslations } from 'next-intl/server';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { StablecoinExplorer } from '@/components/stablecoin-explorer';
import { fetchMeta, fetchStablecoins } from '@/lib/api/client';

export default async function StablecoinsPage() {
  const [meta, catalog] = await Promise.all([fetchMeta(), fetchStablecoins()]);
  const t = await getTranslations('pages');
  const tFooter = await getTranslations('footer');

  return (
    <>
      <SiteHeader
        mode={meta.ok ? meta.data.mode : null}
        engineVersion={
          meta.ok
            ? (meta.data.stablecoinRoutingEngineVersion ?? meta.data.engineVersion)
            : null
        }
      />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        <div className="mb-8 max-w-2xl">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t('stablecoinsTitle')}</h1>
          <p className="text-muted-foreground mt-2 text-sm sm:text-base">{t('stablecoinsLede')}</p>
        </div>
        <StablecoinExplorer catalog={catalog.ok ? catalog.data : null} />
      </main>
      <SiteFooter notice={tFooter('stablecoinsNotice')} />
    </>
  );
}
