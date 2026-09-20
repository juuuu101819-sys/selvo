import { getTranslations } from 'next-intl/server';
import { GraphExplorer } from '@/components/graph-explorer';
import { MarketingPageShell } from '@/components/marketing/marketing-page-shell';
import { fetchMeta, fetchRouteGraph } from '@/lib/api/client';

export default async function GraphPage() {
  const [meta, graph] = await Promise.all([fetchMeta(), fetchRouteGraph()]);
  const t = await getTranslations('pages');

  return (
    <MarketingPageShell
      noticeKey="graphNotice"
      engineVersion={
        meta.ok ? (meta.data.graphEngineVersion ?? meta.data.engineVersion) : null
      }
    >
      <div className="max-w-2xl space-y-2">
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          {t('graphTitle')}
        </h1>
        <p className="text-muted-foreground text-sm sm:text-base">{t('graphLede')}</p>
      </div>
      <GraphExplorer graph={graph.ok ? graph.data : null} />
    </MarketingPageShell>
  );
}
