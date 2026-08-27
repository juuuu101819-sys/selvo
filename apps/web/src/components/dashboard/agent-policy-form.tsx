'use client';

import { useMemo, useState, useTransition, type FormEvent } from 'react';
import { saveAgentPolicy } from '@/app/actions';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AgentPolicyControlsDto } from '@/lib/api/types';
import { majorToMinorUnits, minorToMajorUnits } from '@/lib/format';

const PREFERENCE_LABELS: Record<string, string> = {
  lowest_cost: 'Lowest cost',
  fastest: 'Fastest',
  recommended: 'Recommended',
  balanced: 'Balanced',
  lowest_slippage: 'Lowest slippage',
  high_liquidity: 'High liquidity',
};

export function AgentPolicyForm({
  agentId,
  controls,
}: {
  agentId: string;
  controls: AgentPolicyControlsDto;
}) {
  const policy = controls.policy;
  const exponent = controls.spending?.exponent ?? 2;
  const [maxTransaction, setMaxTransaction] = useState(
    policy === null ? '' : minorToMajorUnits(policy.maxTransactionAmountMinorUnits, exponent),
  );
  const [dailyLimit, setDailyLimit] = useState(
    policy === null ? '' : minorToMajorUnits(policy.dailySpendingLimitMinorUnits, exponent),
  );
  const [assets, setAssets] = useState<readonly string[]>(policy?.allowedAssets ?? []);
  const [providers, setProviders] = useState<readonly string[]>(policy?.allowedProviderIds ?? []);
  const [recipients, setRecipients] = useState<readonly string[]>(
    policy?.allowedRecipientCodes ?? [],
  );
  const [preference, setPreference] = useState<string>(
    policy?.preferredRoutePreference ?? 'lowest_cost',
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const emptyList = useMemo(
    () => assets.length === 0 || providers.length === 0 || recipients.length === 0,
    [assets, providers, recipients],
  );

  if (policy === null) {
    return (
      <Alert>
        <AlertTitle>No payment policy</AlertTitle>
        <AlertDescription>
          This agent has no spending policy yet. Create one from the agent payment API before
          editing controls here.
        </AlertDescription>
      </Alert>
    );
  }

  const existingPolicy = policy;

  function toggle(list: readonly string[], value: string, setter: (next: readonly string[]) => void) {
    setter(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    const maxMinor = majorToMinorUnits(maxTransaction, exponent);
    const dailyMinor = majorToMinorUnits(dailyLimit, exponent);
    if (maxMinor === null || dailyMinor === null) {
      setError('Spending limits must be non-negative decimal amounts in major units.');
      return;
    }
    startTransition(async () => {
      const result = await saveAgentPolicy(agentId, {
        maxTransactionAmountMinorUnits: maxMinor,
        dailySpendingLimitMinorUnits: dailyMinor,
        dailySpendingAsset: existingPolicy.dailySpendingAsset,
        allowedAssets: [...assets],
        allowedProviderIds: [...providers],
        allowedRecipientCodes: [...recipients],
        preferredRoutePreference: preference === '' ? null : preference,
      });
      if (!result.ok) {
        setError(result.failure.message);
        return;
      }
      setError(null);
      setSaved(true);
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {emptyList ? (
        <Alert>
          <AlertTitle>Empty lists deny every payment</AlertTitle>
          <AlertDescription>
            An empty allow-list means none, not all. The policy engine fails closed. Leave at least
            one asset, provider and recipient if this agent should still quote.
          </AlertDescription>
        </Alert>
      ) : null}
      {error !== null ? (
        <Alert variant="destructive">
          <AlertTitle>Policy was not saved</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {saved ? (
        <Alert>
          <AlertTitle>Policy updated</AlertTitle>
          <AlertDescription>
            Spending limits and allow-lists apply to the next quote, authorization and simulation.
            Funds still never move.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card size="sm">
        <CardHeader>
          <CardTitle>Spending limits</CardTitle>
          <CardDescription>
            Amounts in {policy.dailySpendingAsset} major units. Stored as integer minor units.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="max-transaction">Max per payment</Label>
            <Input
              id="max-transaction"
              inputMode="decimal"
              value={maxTransaction}
              onChange={(event) => setMaxTransaction(event.target.value)}
              aria-describedby="max-transaction-hint"
            />
            <p id="max-transaction-hint" className="text-muted-foreground text-xs">
              Demo default is 1,000 {policy.dailySpendingAsset}.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="daily-limit">Daily spending limit</Label>
            <Input
              id="daily-limit"
              inputMode="decimal"
              value={dailyLimit}
              onChange={(event) => setDailyLimit(event.target.value)}
              aria-describedby="daily-limit-hint"
            />
            <p id="daily-limit-hint" className="text-muted-foreground text-xs">
              Completed and authorized simulations consume the daily cap.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Allowed assets</CardTitle>
          <CardDescription>Source assets this agent may quote. Empty means none.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {controls.availableAssets.map((asset) => (
            <Button
              key={asset}
              type="button"
              size="sm"
              variant={assets.includes(asset) ? 'default' : 'outline'}
              aria-pressed={assets.includes(asset)}
              onClick={() => toggle(assets, asset, setAssets)}
            >
              {asset}
            </Button>
          ))}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Allowed providers</CardTitle>
          <CardDescription>
            Licensed sandbox rails this agent may select. Empty means none.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {controls.availableProviders.map((provider) => (
            <Button
              key={provider.id}
              type="button"
              size="sm"
              variant={providers.includes(provider.id) ? 'default' : 'outline'}
              aria-pressed={providers.includes(provider.id)}
              onClick={() => toggle(providers, provider.id, setProviders)}
            >
              {provider.name}
            </Button>
          ))}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Allowed recipients</CardTitle>
          <CardDescription>Merchants this agent may pay. Empty means none.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {controls.availableRecipients.map((recipient) => (
            <Button
              key={recipient.code}
              type="button"
              size="sm"
              variant={recipients.includes(recipient.code) ? 'default' : 'outline'}
              aria-pressed={recipients.includes(recipient.code)}
              onClick={() => toggle(recipients, recipient.code, setRecipients)}
            >
              {recipient.name}
            </Button>
          ))}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Route preference</CardTitle>
          <CardDescription>
            Default ranking when the agent does not name a preference on the intent. This is not a
            wallet or key setting.
          </CardDescription>
        </CardHeader>
        <CardContent className="max-w-sm">
          <Label htmlFor="route-preference" className="sr-only">
            Route preference
          </Label>
          <Select value={preference} onValueChange={(next) => next !== null && setPreference(next)}>
            <SelectTrigger id="route-preference" aria-label="Route preference" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {controls.routePreferences.map((value) => (
                <SelectItem key={value} value={value}>
                  {PREFERENCE_LABELS[value] ?? value.replaceAll('_', ' ')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Button type="submit" disabled={pending}>
        {pending ? 'Saving policy…' : 'Save policy'}
      </Button>
    </form>
  );
}
