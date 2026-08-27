'use client';

import { useState, type FormEvent } from 'react';
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
  const [agentId, setAgentId] = useState(agents[0]?.id ?? '');
  const [instruction, setInstruction] = useState(
    'Pay 1,000 USD to this merchant using the cheapest compliant route.',
  );
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
        <h2 className="text-sm font-semibold">Sign in required</h2>
        <p className="text-muted-foreground mt-2 text-sm">
          Agent payment intents are scoped to an organization. Sign in as the demo treasury operator
          to create an intent, request a quote, authorize, and run the sandbox simulator. The
          platform never holds the agent wallet.
        </p>
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div className="border-border rounded-xl border p-5">
        <h2 className="text-sm font-semibold">No agents yet</h2>
        <p className="text-muted-foreground mt-2 text-sm">
          Issue an agent from the API, or load the sandbox demo tenant. Agents act for the
          organization and never custody funds here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section className="grid gap-6 lg:grid-cols-3">
        <div className="border-border rounded-xl border p-4">
          <h2 className="text-sm font-semibold">Agents</h2>
          <ul className="mt-3 space-y-2 font-mono text-xs">
            {agents.map((agent) => (
              <li key={agent.id}>
                {agent.name} · {agent.status} · {agent.keyPrefix ?? 'no credential'}
              </li>
            ))}
          </ul>
        </div>
        <div className="border-border rounded-xl border p-4">
          <h2 className="text-sm font-semibold">Merchants</h2>
          {merchants.length === 0 ? (
            <p className="text-muted-foreground mt-2 text-xs">No merchants in this organization.</p>
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
          <h2 className="text-sm font-semibold">Policy</h2>
          {policies.length === 0 ? (
            <p className="text-muted-foreground mt-2 text-xs">No payment policy configured.</p>
          ) : (
            <ul className="mt-3 space-y-2 text-xs">
              {policies.map((policy) => (
                <li key={policy.id}>
                  Max {policy.maxTransactionAmountMinorUnits} minor units · daily{' '}
                  {policy.dailySpendingLimitMinorUnits} {policy.dailySpendingAsset} · fee cap{' '}
                  {policy.maxFeeBps} bps
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <form onSubmit={onCreate} className="border-border space-y-4 rounded-xl border p-4 sm:p-5">
        <div>
          <h2 className="text-sm font-semibold">Create a payment intent</h2>
          <p className="text-muted-foreground mt-1 text-xs">
            An instruction such as{' '}
            <code>Pay 1,000 USD to this merchant using the cheapest compliant route.</code> becomes
            a structured intent. The parser never prices the payment. Quotes come from the routing
            engine. Simulation never moves money.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="agent">Agent</Label>
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
            <Label htmlFor="instruction">Instruction</Label>
            <Input
              id="instruction"
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder="Pay 1,000 USD to this merchant using the cheapest compliant route."
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
            Interpret intent
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
            Route from language
          </Button>
          <Button type="submit" variant="outline" disabled={pending || agentId === ''}>
            Create intent
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
            Request quote
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
            Select recommended route
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
            Authorize
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
            Simulate execution
          </Button>
        </div>
      </form>

      {interpretation !== null && (
        <section className="border-border space-y-3 rounded-xl border p-4 sm:p-5">
          <h2 className="text-sm font-semibold">Structured intent</h2>
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
        <p className="text-muted-foreground text-sm">Creating the payment intent…</p>
      )}

      {intent !== null && (
        <section className="border-border space-y-3 rounded-xl border p-4 sm:p-5">
          <h2 className="text-sm font-semibold">Intent {intent.status}</h2>
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
