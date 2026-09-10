'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import {
  authorizeAgentPaymentIntent,
  createAgentPaymentIntent,
  interpretAgentPaymentInstruction,
  quoteAgentPaymentIntent,
  routeAgentPaymentInstruction,
  selectAgentPaymentRoute,
  simulateAgentPaymentIntent,
} from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type {
  MerchantDto,
  NlRouteResultDto,
  PaymentIntentDto,
  PaymentPolicyDto,
  PublicAgentDto,
  StructuredNlPaymentIntentDto,
} from '@/lib/api/types';

export function AgentPaymentsExplorer({
  agents,
  merchants,
  policies,
  signedIn,
}: {
  agents: readonly PublicAgentDto[];
  merchants: readonly MerchantDto[];
  policies: readonly PaymentPolicyDto[];
  signedIn: boolean;
}) {
  const t = useTranslations('agents');
  const [agentId, setAgentId] = useState(agents[0]?.id ?? '');
  const [instruction, setInstruction] = useState(t('instructionExample'));
  const [intent, setIntent] = useState<PaymentIntentDto | null>(null);
  const [interpretation, setInterpretation] = useState<StructuredNlPaymentIntentDto | null>(null);
  const [nlRoute, setNlRoute] = useState<NlRouteResultDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function run(action: () => Promise<{ ok: true; data: PaymentIntentDto } | { ok: false; failure: { message: string } }>) {
    setPending(true);
    setError(null);
    const result = await action();
    setPending(false);
    if (!result.ok) {
      setError(result.failure.message);
      return;
    }
    setIntent(result.data);
  }

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    await run(() => createAgentPaymentIntent({ agentId, instruction }));
  }

  if (!signedIn) {
    return (
      <div className="border-border rounded-xl border p-5">
        <h2 className="text-sm font-semibold">{t('signInRequired')}</h2>
        <p className="text-muted-foreground mt-2 text-sm">{t('signInRequiredBody')}</p>
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div className="border-border rounded-xl border p-5">
        <h2 className="text-sm font-semibold">{t('noAgentsExplorer')}</h2>
        <p className="text-muted-foreground mt-2 text-sm">{t('noAgentsExplorerBody')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section className="grid gap-6 lg:grid-cols-3">
        <div className="border-border rounded-xl border p-4">
          <h2 className="text-sm font-semibold">{t('agentsHeading')}</h2>
          <ul className="mt-3 space-y-2 font-mono text-xs">
            {agents.map((agent) => (
              <li key={agent.id}>
                {agent.name} · {agent.status} · {agent.keyPrefix ?? t('noCredential')}
              </li>
            ))}
          </ul>
        </div>
        <div className="border-border rounded-xl border p-4">
          <h2 className="text-sm font-semibold">{t('merchantsHeading')}</h2>
          {merchants.length === 0 ? (
            <p className="text-muted-foreground mt-2 text-xs">{t('noMerchants')}</p>
          ) : (
            <ul className="mt-3 space-y-2 font-mono text-xs">
              {merchants.map((merchant) => (
                <li key={merchant.id}>
                  {merchant.name} · {merchant.recipientCode} · {merchant.settlementAsset}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="border-border rounded-xl border p-4">
          <h2 className="text-sm font-semibold">{t('policyHeading')}</h2>
          {policies.length === 0 ? (
            <p className="text-muted-foreground mt-2 text-xs">{t('noPolicy')}</p>
          ) : (
            <ul className="mt-3 space-y-3 text-xs">
              {policies.map((policy) => (
                <li key={policy.id} className="space-y-1">
                  <p>
                    Max {policy.maxTransactionAmountMinorUnits} minor units · daily{' '}
                    {policy.dailySpendingLimitMinorUnits} {policy.dailySpendingAsset}
                  </p>
                  <p>
                    Assets {(policy.allowedAssets ?? []).join(', ') || 'none'} · recipients{' '}
                    {(policy.allowedRecipientCodes ?? []).join(', ') || 'none'}
                  </p>
                  <p>
                    Providers {(policy.allowedProviderIds ?? []).join(', ') || 'none'} · chains{' '}
                    {(policy.allowedChainIds ?? []).join(', ') || 'fiat only'} · countries{' '}
                    {(policy.allowedCountryCodes ?? []).join(', ') || 'none'}
                  </p>
                  <p>
                    Fee cap {policy.maxFeeBps} bps · slippage {policy.maxSlippageBps ?? '—'} bps · min
                    score {policy.minRouteScore ?? '—'} · min liquidity{' '}
                    {policy.minLiquidityHeadroom ?? '—'}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <form onSubmit={onCreate} className="border-border space-y-4 rounded-xl border p-4 sm:p-5">
        <div>
          <h2 className="text-sm font-semibold">{t('createIntent')}</h2>
          <p className="text-muted-foreground mt-1 text-xs">
            {t('createIntentBody', { example: t('instructionExample') })}
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="agent">{t('agentLabel')}</Label>
            <select
              id="agent"
              className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
              value={agentId}
              onChange={(event) => setAgentId(event.target.value)}
            >
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="instruction">{t('instructionLabel')}</Label>
            <Input
              id="instruction"
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder={t('instructionExample')}
            />
          </div>
        </div>
        {error !== null && (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={pending || agentId === ''}
            onClick={() => {
              void (async () => {
                setPending(true);
                setError(null);
                const result = await interpretAgentPaymentInstruction({ agentId, instruction });
                setPending(false);
                if (!result.ok) {
                  setError(result.failure.message);
                  return;
                }
                setInterpretation(result.data.interpretation);
              })();
            }}
          >
            {t('interpretIntent')}
          </Button>
          <Button
            type="button"
            disabled={pending || agentId === ''}
            onClick={() => {
              void (async () => {
                setPending(true);
                setError(null);
                const result = await routeAgentPaymentInstruction({ agentId, instruction });
                setPending(false);
                if (!result.ok) {
                  setError(result.failure.message);
                  return;
                }
                setInterpretation(result.data.interpretation);
                setNlRoute(result.data);
                setIntent(result.data.paymentIntent);
              })();
            }}
          >
            {t('routeFromLanguage')}
          </Button>
          <Button type="submit" variant="outline" disabled={pending || agentId === ''}>
            {t('createIntentButton')}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending || intent === null}
            onClick={() => {
              if (intent !== null) {
                void run(() => quoteAgentPaymentIntent(intent.id));
              }
            }}
          >
            {t('requestQuote')}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending || intent === null || intent.quotedRoutes[0] === undefined}
            onClick={() => {
              const routeId = intent?.quotedRoutes[0]?.routeId;
              if (intent !== null && routeId !== undefined) {
                void run(() => selectAgentPaymentRoute(intent.id, routeId));
              }
            }}
          >
            {t('selectRecommended')}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending || intent === null}
            onClick={() => {
              if (intent !== null) {
                void run(() => authorizeAgentPaymentIntent(intent.id));
              }
            }}
          >
            {t('authorize')}
          </Button>
          <Button
            type="button"
            disabled={pending || intent === null}
            onClick={() => {
              if (intent !== null) {
                void run(() => simulateAgentPaymentIntent(intent.id));
              }
            }}
          >
            {t('simulateExecution')}
          </Button>
        </div>
      </form>

      {interpretation !== null && (
        <section className="border-border space-y-3 rounded-xl border p-4 sm:p-5">
          <h2 className="text-sm font-semibold">{t('structuredIntent')}</h2>
          <p className="text-muted-foreground text-sm">
            {interpretation.amount.decimal} {interpretation.sourceAsset} → {interpretation.destinationAsset}{' '}
            for {interpretation.recipient}. Preference {interpretation.optimizationPreference ?? 'none'}.
            Interpreter {interpretation.interpreter}. aiUsed={String(interpretation.aiUsed)}.
          </p>
          <p className="font-mono text-xs">
            financialsComputedBy={String(interpretation.financialsComputedBy)} didNotCompute=
            {interpretation.didNotCompute.join(', ')}
          </p>
          {nlRoute !== null && (
            <p className="text-sm">
              Pipeline {nlRoute.pipelineCompleted.join(' → ')}. Execution intent{' '}
              {nlRoute.executionIntent.status}, executable={String(nlRoute.executable)}, submitted=
              {String(nlRoute.submitted)}.
            </p>
          )}
        </section>
      )}

      {pending && intent === null && interpretation === null && (
        <p className="text-muted-foreground text-sm">{t('creatingIntent')}</p>
      )}

      {intent !== null && (
        <section className="border-border space-y-3 rounded-xl border p-4 sm:p-5">
          <h2 className="text-sm font-semibold">{t('intentStatus', { status: intent.status })}</h2>
          <p className="text-muted-foreground text-sm">
            {intent.purpose}. {intent.amount.decimal} {intent.amount.asset} → {intent.destinationAsset}{' '}
            for {intent.recipient}.
          </p>
          <p className="font-mono text-xs">
            fundsMoved={String(intent.fundsMoved)} custody={String(intent.custody)} realExecution=
            {String(intent.realExecution)}
          </p>
          {intent.quotedRoutes.length > 0 && (
            <ul className="space-y-1 font-mono text-xs">
              {intent.quotedRoutes.map((route) => (
                <li key={route.routeId}>
                  {route.rank}. {route.providerName} · {route.rail} · {route.totalCostBps} bps
                  {route.routeScore != null && route.routeScore !== '' ? ` · score ${route.routeScore}` : ''}
                  {route.slippageBps != null && route.slippageBps !== ''
                    ? ` · slip ${route.slippageBps} bps`
                    : ''}
                  {route.chainId != null && route.chainId !== '' ? ` · ${route.chainId}` : ''}
                  {route.recommended ? ' · recommended' : ''}
                </li>
              ))}
            </ul>
          )}
          {intent.simulation !== null && (
            <p className="text-sm">{intent.simulation.receipt}</p>
          )}
        </section>
      )}
    </div>
  );
}
