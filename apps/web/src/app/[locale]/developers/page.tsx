import { getTranslations } from 'next-intl/server';
import { RoutingApiExplorer } from '@/components/routing-api-explorer';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { fetchAssets, fetchCurrencies, fetchMeta } from '@/lib/api/client';
import { readSessionToken } from '@/lib/session';

export default async function DevelopersPage() {
  const [meta, assets, currencies, token] = await Promise.all([
    fetchMeta(),
    fetchAssets(),
    fetchCurrencies(),
    readSessionToken(),
  ]);
  const t = await getTranslations('pages');
  const tFooter = await getTranslations('footer');

  return (
    <>
      <SiteHeader
        mode={meta.ok ? meta.data.mode : null}
        engineVersion={meta.ok ? meta.data.engineVersion : null}
      />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        <div className="mb-8 max-w-2xl">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t('developersTitle')}</h1>
          <p className="text-muted-foreground mt-2 text-sm sm:text-base">
            {t.rich('developersLede', {
              path: '/api/v1',
              intent: 'transaction:create',
              code: (chunks) => <code>{chunks}</code>,
            })}
          </p>
        </div>
        <RoutingApiExplorer
          assets={assets.ok ? assets.data.assets : []}
          currencies={currencies.ok ? currencies.data.currencies : []}
          signedIn={token !== null}
        />
      </main>
      <SiteFooter notice={tFooter('developersNotice')} />
    </>
  );
}
