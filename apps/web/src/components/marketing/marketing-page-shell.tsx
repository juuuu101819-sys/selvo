import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { SiteHeader } from '@/components/site-header';
import { fetchMeta } from '@/lib/api/client';
import { MarketingFooter } from './marketing-footer';
import { MarketingShell } from './marketing-shell';

export type MarketingNoticeKey =
  | 'marketingNotice'
  | 'trustNotice'
  | 'resourcesNotice'
  | 'devDocsNotice'
  | 'howItWorksNotice'
  | 'graphNotice';

export async function MarketingPageShell({
  noticeKey,
  children,
  engineVersion,
}: {
  noticeKey: MarketingNoticeKey;
  children: ReactNode;
  engineVersion?: string | null;
}) {
  const meta = await fetchMeta();
  const tFooter = await getTranslations('footer');

  return (
    <MarketingShell>
      <SiteHeader
        mode={meta.ok ? meta.data.mode : null}
        engineVersion={
          engineVersion ?? (meta.ok ? meta.data.engineVersion : null)
        }
      />
      <main className="mx-auto w-full max-w-6xl flex-1 space-y-16 px-4 py-10 sm:px-6 sm:py-14">
        {children}
      </main>
      <MarketingFooter notice={tFooter(noticeKey)} />
    </MarketingShell>
  );
}
