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

  return (
    <>
      <SiteHeader
        mode={meta.ok ? meta.data.mode : null}
        engineVersion={meta.ok ? meta.data.engineVersion : null}
      />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        <p className="text-muted-foreground font-mono text-[11px] tracking-wide uppercase">
          Draft · not in force · updated {LEGAL_DRAFT_UPDATED}
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        <aside className="border-border bg-muted/40 mt-6 rounded-xl border p-4 text-sm">
          <p>
            This page describes how Meridian works today. It is a product disclosure pending legal
            counsel review, not a binding contract, privacy notice in force, or licence. Do not
            treat it as terms you have agreed to. Counsel must replace this draft before it is
            represented as in force.
          </p>
        </aside>
        <div className="mt-8 space-y-6 text-sm leading-relaxed">{children}</div>
      </main>
      <SiteFooter notice="Meridian is non-custodial. It never holds customer funds, private keys or wallets, and does not execute or delegate settlement. Quotes are indicative." />
    </>
  );
}
