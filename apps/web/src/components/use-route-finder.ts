'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { compareRoutes } from '@/app/actions';
import type { FormValue } from '@/components/comparison-form';
import type { ApiFailure, ComparisonDto, MetaDto } from '@/lib/api/types';
import { weightsFor } from '@/lib/priorities';

export type RouteFinderViewState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'success'; readonly comparison: ComparisonDto; readonly disclaimer: string }
  | { readonly kind: 'error'; readonly failure: ApiFailure };

export const ROUTE_FINDER_INITIAL_FORM: FormValue = {
  sourceCurrency: 'USD',
  targetCurrency: 'KRW',
  amount: '100000.00',
  rails: [],
  priority: 'balanced',
};

export function useRouteFinder({
  meta,
  embedded = false,
  autoRun = false,
}: {
  meta: MetaDto;
  embedded?: boolean;
  autoRun?: boolean;
}) {
  const [form, setForm] = useState<FormValue>(ROUTE_FINDER_INITIAL_FORM);
  const [state, setState] = useState<RouteFinderViewState>({ kind: 'idle' });
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
    if (!autoRun || prefillDone.current) {
      return;
    }
    prefillDone.current = true;
    runComparison(ROUTE_FINDER_INITIAL_FORM);
  }, [autoRun]);

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
    (isPending || (embedded && state.kind === 'idle' && autoRun)) && state.kind !== 'success';

  const showResultsPanel =
    showInitialSkeleton || state.kind === 'success' || state.kind === 'error';

  return {
    meta,
    form,
    setForm,
    state,
    isPending,
    submit,
    embedded,
    showInitialSkeleton,
    showResultsPanel,
  };
}
