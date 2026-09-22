'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { CodeCopyButton } from './code-copy-button';
import { SectionShell } from './section-shell';

const QUICKSTART = [
  { step: 1, title: 'Get sandbox keys', detail: 'Sign in — no funds or license required.' },
  { step: 2, title: 'Send an intent', detail: 'POST a normalized comparison request.' },
  { step: 3, title: 'Receive a signed route', detail: 'Best-execution decision with comparison ID — execution stays 501.' },
] as const;

type RequestTab = 'curl' | 'node' | 'python';
type ResponseTab = 'response' | 'error' | 'webhook';

const REQUEST_SAMPLES: Record<RequestTab, string> = {
  curl: `curl -X POST https://api.meridian.dev/api/v1/comparisons \\
  -H "Authorization: Bearer mk_sandbox_demo" \\
  -H "Content-Type: application/json" \\
  -d '{
    "sourceCurrency": "USD",
    "targetCurrency": "EUR",
    "amount": "50000.00"
  }'`,
  node: `const res = await fetch(
  'https://api.meridian.dev/api/v1/comparisons',
  {
    method: 'POST',
    headers: {
      Authorization: 'Bearer mk_sandbox_demo',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sourceCurrency: 'USD',
      targetCurrency: 'EUR',
      amount: '50000.00',
    }),
  },
);
const comparison = await res.json();`,
  python: `import requests

comparison = requests.post(
    "https://api.meridian.dev/api/v1/comparisons",
    headers={
        "Authorization": "Bearer mk_sandbox_demo",
        "Content-Type": "application/json",
    },
    json={
        "sourceCurrency": "USD",
        "targetCurrency": "EUR",
        "amount": "50000.00",
    },
).json()`,
};

const RESPONSE_SAMPLES: Record<ResponseTab, string> = {
  response: `{
  "comparisonId": "cmp_sandbox_01HXYZ",
  "mode": "sandbox",
  "execution": false,
  "recommendedRouteId": "route_stablecoin_circle",
  "routes": [
    {
      "routeId": "route_stablecoin_circle",
      "recommended": true,
      "totalCostBps": "44.00",
      "provider": { "name": "Demo Stablecoin" }
    }
  ],
  "disclosure": "Non-custodial — partners settle"
}`,
  error: `{
  "statusCode": 501,
  "error": "Not Implemented",
  "message": "POST /api/v1/executions is gated by design.",
  "mode": "sandbox",
  "execution": false,
  "hint": "Meridian returns decisions only — never moves funds."
}`,
  webhook: `{
  "event": "comparison.completed",
  "mode": "sandbox",
  "execution": false,
  "comparisonId": "cmp_sandbox_01HXYZ",
  "organizationId": "org_demo",
  "note": "Webhook delivery is sandbox-only in this demo."
}`,
};

function CodePanel({
  tabs,
  active,
  onSelect,
  code,
}: {
  tabs: { id: string; label: string }[];
  active: string;
  onSelect: (id: string) => void;
  code: string;
}) {
  return (
    <div className="marketing-surface-feature marketing-surface overflow-hidden rounded-xl">
      <div className="border-border/60 flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex flex-wrap gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelect(tab.id)}
              className={cn(
                'rounded-md px-2 py-1 font-mono text-[10px] uppercase tracking-wide transition-colors',
                active === tab.id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <CodeCopyButton code={code} />
      </div>
      <pre className="bg-background/40 max-h-64 overflow-auto p-4 font-mono text-[11px] leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/**
 * Expanded developers section — quickstart + dual code panels with copy (mockup batch 3/3).
 */
export function DevelopersSectionExpanded() {
  const [requestTab, setRequestTab] = useState<RequestTab>('curl');
  const [responseTab, setResponseTab] = useState<ResponseTab>('response');

  return (
    <SectionShell
      eyebrow="Developers"
      heading="One API, every rail — sandbox by default"
      subheading="Non-custodial: mode sandbox, execution false. POST /executions stays 501."
    >
      <ol className="grid gap-3 sm:grid-cols-3">
        {QUICKSTART.map((item) => (
          <li
            key={item.step}
            className="marketing-surface-feature marketing-surface rounded-xl p-4"
          >
            <span className="bg-accent/15 text-accent-foreground inline-flex size-7 items-center justify-center rounded-full font-mono text-xs tabular-nums">
              {item.step}
            </span>
            <h3 className="mt-3 text-sm font-semibold">{item.title}</h3>
            <p className="text-muted-foreground mt-1 text-xs leading-relaxed">{item.detail}</p>
          </li>
        ))}
      </ol>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <p className="text-muted-foreground text-xs font-medium uppercase tracking-widest">Request</p>
          <CodePanel
            tabs={[
              { id: 'curl', label: 'cURL' },
              { id: 'node', label: 'Node' },
              { id: 'python', label: 'Python' },
            ]}
            active={requestTab}
            onSelect={(id) => setRequestTab(id as RequestTab)}
            code={REQUEST_SAMPLES[requestTab]}
          />
        </div>
        <div className="space-y-2">
          <p className="text-muted-foreground text-xs font-medium uppercase tracking-widest">Response</p>
          <CodePanel
            tabs={[
              { id: 'response', label: 'Response' },
              { id: 'error', label: 'Error' },
              { id: 'webhook', label: 'Webhook' },
            ]}
            active={responseTab}
            onSelect={(id) => setResponseTab(id as ResponseTab)}
            code={RESPONSE_SAMPLES[responseTab]}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="secondary" className="font-mono text-[10px] uppercase">
          Sandbox
        </Badge>
        <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/developers" />}>
          Open developer hub
        </Button>
      </div>
    </SectionShell>
  );
}
