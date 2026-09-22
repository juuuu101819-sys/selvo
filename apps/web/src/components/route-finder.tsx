'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
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

export function RouteFinder({ meta, embedded = false }: { meta: MetaDto; embedded?: boolean }) {
  const t = useTranslations('comparison');
  const [form, setForm] = useState<FormValue>(INITIAL_FORM);
  const [state, setState] = useState<ViewState>({ kind: 'idle' });
  const [isPending, startTransition] = useTransition();
  const prefillDone = useRef(false);
  const priorityRef = useRef(form.priority);

  const runComparison = (values: FormValue): void => {
    startTransition(async () => {
      const result = await compareRoutes({
        sourceCurrency: values.sourceCurrency,
        targetCurrency: values.targetCurrency,
        amount: values.amount,
        rails: values.rails,
        weights: weightsFor(values.priority),
      });

      setState(
        result.ok
          ? { kind: 'success', comparison: result.data, disclaimer: result.disclaimer }
          : { kind: 'error', failure: result.failure },
      );
    });
  };

  const submit = (): void => {
    runComparison(form);
  };

  useEffect(() => {
    if (!embedded || prefillDone.current) {
      return;
    }
    prefillDone.current = true;
    runComparison(INITIAL_FORM);
  }, [embedded]);

  useEffect(() => {
    if (state.kind !== 'success') {
      priorityRef.current = form.priority;
      return;
    }
    if (priorityRef.current === form.priority) {
      return;
    }
    priorityRef.current = form.priority;
    runComparison(form);
  }, [form.priority, state.kind]);

  const showInitialSkeleton =
    (isPending || (embedded && state.kind === 'idle')) && state.kind !== 'success';

  return (
    <div className="space-y-6">
      <Card className={embedded ? 'marketing-surface ring-0' : undefined}>
        <CardHeader>
          <CardTitle>{t('cardTitle')}</CardTitle>
          <CardDescription>{t('cardDescription')}</CardDescription>
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

      {showInitialSkeleton && <ResultsSkeleton />}

      {!embedded && !isPending && state.kind === 'idle' && <EmptyState />}
      {!isPending && state.kind === 'error' && <ErrorState failure={state.failure} />}
      {state.kind === 'success' && (
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
