'use client';

import { useState, useTransition } from 'react';
import { compareRoutes } from '@/app/actions';
import { ComparisonForm, type FormValue } from '@/components/comparison-form';
import { ComparisonResult } from '@/components/comparison-result';
import { EmptyState, ErrorState, ResultsSkeleton } from '@/components/states';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { ApiFailure, ComparisonDto, MetaDto } from '@/lib/api/types';
import { weightsFor } from '@/lib/priorities';

type ViewState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'success'; readonly comparison: ComparisonDto; readonly disclaimer: string }
  | { readonly kind: 'error'; readonly failure: ApiFailure };

const INITIAL_FORM: FormValue = {
  sourceCurrency: 'USD',
  targetCurrency: 'KRW',
  amount: '100000.00',
  rails: [],
  priority: 'balanced',
};

export function RouteFinder({ meta }: { meta: MetaDto }) {
  const [form, setForm] = useState<FormValue>(INITIAL_FORM);
  const [state, setState] = useState<ViewState>({ kind: 'idle' });
  const [isPending, startTransition] = useTransition();

  const submit = (): void => {
    startTransition(async () => {
      const result = await compareRoutes({
        sourceCurrency: form.sourceCurrency,
        targetCurrency: form.targetCurrency,
        amount: form.amount,
        rails: form.rails,
        weights: weightsFor(form.priority),
      });

      setState(
        result.ok
          ? { kind: 'success', comparison: result.data, disclaimer: result.disclaimer }
          : { kind: 'error', failure: result.failure },
      );
    });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Compare a transaction</CardTitle>
          <CardDescription>
            Every route is priced against the mid-market rate, so a zero-fee quote on a wide spread
            cannot look cheaper than an explicit fee on a keen rate.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ComparisonForm
            currencies={meta.currencies}
            rails={meta.rails}
            value={form}
            isPending={isPending}
            onChange={setForm}
            onSubmit={submit}
          />
        </CardContent>
      </Card>

      {isPending && <ResultsSkeleton />}

      {!isPending && state.kind === 'idle' && <EmptyState />}
      {!isPending && state.kind === 'error' && <ErrorState failure={state.failure} />}
      {!isPending && state.kind === 'success' && (
        <ComparisonResult
          comparison={state.comparison}
          disclaimer={state.disclaimer}
          onRefresh={submit}
          refreshing={isPending}
        />
      )}
    </div>
  );
}
