'use client';

import { useTranslations } from 'next-intl';
import { ComparisonForm } from '@/components/comparison-form';
import { ComparisonResult } from '@/components/comparison-result';
import { EmptyState, ErrorState, ResultsSkeleton } from '@/components/states';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { useRouteFinder } from '@/components/use-route-finder';

type RouteFinderController = ReturnType<typeof useRouteFinder>;

export function RouteFinderFormCard({
  controller,
  embedded,
}: {
  controller: RouteFinderController;
  embedded?: boolean;
}) {
  const t = useTranslations('comparison');
  const { meta, form, setForm, isPending, submit } = controller;

  return (
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
  );
}

export function RouteFinderResultsPanel({
  controller,
  embedded,
}: {
  controller: RouteFinderController;
  embedded?: boolean;
}) {
  const { showInitialSkeleton, isPending, state, submit, embedded: isEmbedded } = controller;

  if (showInitialSkeleton) {
    return <ResultsSkeleton />;
  }

  if (!isPending && state.kind === 'idle' && !embedded) {
    return <EmptyState />;
  }

  if (!isPending && state.kind === 'error') {
    return <ErrorState failure={state.failure} />;
  }

  if (state.kind === 'success') {
    return (
      <ComparisonResult
        comparison={state.comparison}
        disclaimer={state.disclaimer}
        onRefresh={submit}
        refreshing={isPending}
      />
    );
  }

  return isEmbedded ? null : <EmptyState />;
}
