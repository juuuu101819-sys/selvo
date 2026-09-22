'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { BrowserFrame } from './browser-frame';
import { CodeCopyButton } from './code-copy-button';
import { SectionShell } from './section-shell';

const NAV = [
  { id: 'overview', label: 'Overview' },
  { id: 'quickstart', label: 'Quickstart' },
  { id: 'comparisons', label: 'Comparisons' },
  { id: 'sandbox', label: 'Sandbox mode' },
  { id: 'non-custodial', label: 'Non-custodial' },
  { id: 'partners', label: 'Partner settlement' },
] as const;

const WORKFLOW = [
  'Create an account and generate sandbox API keys.',
  'Send a comparison intent (currency pair + amount).',
  'Read the ranked routes priced vs mid-market.',
  'Verify reproducibility with the comparison ID.',
  'Confirm execution remains 501 — Meridian never moves funds.',
  'Continue with your licensed partner to settle.',
] as const;

const CODE_SAMPLE = `curl -X POST https://api.meridian.dev/api/v1/comparisons \\
  -H "Authorization: Bearer mk_sandbox_demo" \\
  -H "Content-Type: application/json" \\
  -d '{"sourceCurrency":"USD","targetCurrency":"KRW","amount":"100000.00"}'`;

/**
 * Getting started docs browser mock — static walkthrough (mockup batch 3/3).
 */
export function GettingStartedDocs() {
  const [activeNav, setActiveNav] = useState<(typeof NAV)[number]['id']>('quickstart');

  return (
    <SectionShell
      eyebrow="Getting started"
      heading="From keys to comparison in minutes"
      subheading="Static docs preview — illustrative UI. Sandbox only; no live settlement."
    >
      <BrowserFrame url="docs.meridian.dev/quickstart">
        <div className="grid min-h-[20rem] lg:grid-cols-[10rem_1fr]">
          <nav
            aria-label="Docs navigation demo"
            className="border-border/60 bg-secondary/20 space-y-1 border-b p-3 lg:border-r lg:border-b-0"
          >
            {NAV.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveNav(item.id)}
                className={cn(
                  'block w-full rounded-lg px-2.5 py-2 text-left text-xs font-medium transition-colors',
                  activeNav === item.id
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="space-y-5 p-4 sm:p-5">
            <div>
              <h3 className="text-base font-semibold">Six-step sandbox workflow</h3>
              <p className="text-muted-foreground mt-1 text-xs">
                Non-custodial · execution gated (501) · never holds funds or keys
              </p>
            </div>

            <ol className="space-y-2">
              {WORKFLOW.map((step, index) => (
                <li key={step} className="flex gap-3 text-sm">
                  <span className="bg-primary/15 text-primary flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-[10px] tabular-nums">
                    {index + 1}
                  </span>
                  <span className="text-muted-foreground leading-relaxed">{step}</span>
                </li>
              ))}
            </ol>

            <div className="marketing-surface-feature marketing-surface overflow-hidden rounded-xl">
              <div className="border-border/60 flex items-center justify-between border-b px-3 py-2">
                <span className="text-muted-foreground font-mono text-[10px] uppercase">Sample request</span>
                <CodeCopyButton code={CODE_SAMPLE} />
              </div>
              <pre className="bg-background/40 overflow-x-auto p-4 font-mono text-[11px] leading-relaxed">
                <code>{CODE_SAMPLE}</code>
              </pre>
            </div>
          </div>
        </div>
      </BrowserFrame>
    </SectionShell>
  );
}
