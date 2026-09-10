import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { fetchMeta } from '@/lib/api/client';

export const LEGAL_DRAFT_UPDATED = '10 September 2026';

export async function LegalDocument({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const meta = await fetchMeta();
  const t = await getTranslations('legal');
  const tFooter = await getTranslations('footer');

  return (
    <>
      <SiteHeader
        mode={meta.ok ? meta.data.mode : null}
        engineVersion={meta.ok ? meta.data.engineVersion : null}
      />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        <p className="text-muted-foreground font-mono text-[11px] tracking-wide uppercase">
          {t('draftBanner', { date: LEGAL_DRAFT_UPDATED })}
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        <aside className="border-border bg-muted/40 mt-6 rounded-xl border p-4 text-sm">
          <p>{t('aside')}</p>
        </aside>
        <div className="mt-8 space-y-6 text-sm leading-relaxed">{children}</div>
      </main>
      <SiteFooter notice={tFooter('legalNotice')} />
    </>
  );
}
