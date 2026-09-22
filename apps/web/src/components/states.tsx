'use client';

import { AlertCircle, Route, ServerCrash } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import type { ApiFailure } from '@/lib/api/types';
import { comparisonErrorTitleKey } from '@/lib/error-title';

/** Shown before the first comparison: explains the product rather than showing a blank panel. */
export function EmptyState() {
  const t = useTranslations('states');

  return (
    <div className="border-border/60 rounded-xl border border-dashed p-8 text-center">
      <Route className="text-muted-foreground mx-auto size-8" aria-hidden />
      <h2 className="mt-3 text-base font-semibold">{t('emptyTitle')}</h2>
      <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">{t('emptyBody')}</p>
    </div>
  );
}

export function ResultsSkeleton() {
  const t = useTranslations('states');

  return (
    <div
      className="space-y-6 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-300"
      aria-busy="true"
      aria-label={t('comparingRoutes')}
    >
      <div className="space-y-3">
        <Skeleton className="h-4 w-28 rounded-md" />
        <Skeleton className="h-72 w-full rounded-2xl" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-4 w-40 rounded-md" />
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-44 w-full rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-36 w-full rounded-xl" />
    </div>
  );
}

/**
 * Failure display.
 */
export function ErrorState({ failure }: { failure: ApiFailure }) {
  const t = useTranslations('errors');
  const unreachable = failure.code === 'API_UNREACHABLE' || failure.code === 'API_TIMEOUT';
  const issues = extractIssues(failure.details);

  return (
    <Alert variant="destructive">
      {unreachable ? <ServerCrash aria-hidden /> : <AlertCircle aria-hidden />}
      <AlertTitle>{t(comparisonErrorTitleKey(failure))}</AlertTitle>
      <AlertDescription>
        <p>{failure.message}</p>
        {issues.length > 0 && (
          <ul className="list-inside list-disc">
            {issues.map((issue) => (
              <li key={`${issue.path}-${issue.message}`}>
                {issue.path === '' ? issue.message : `${issue.path}: ${issue.message}`}
              </li>
            ))}
          </ul>
        )}
        <p className="font-mono text-xs opacity-80">
          {failure.code}
          {failure.requestId === null ? '' : ` · ${failure.requestId}`}
        </p>
      </AlertDescription>
    </Alert>
  );
}

function extractIssues(
  details: Record<string, unknown>,
): readonly { path: string; message: string }[] {
  const raw = details['issues'];
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.flatMap((issue) => {
    if (typeof issue !== 'object' || issue === null) {
      return [];
    }
    const candidate = issue as { path?: unknown; message?: unknown };
    if (typeof candidate.message !== 'string') {
      return [];
    }
    return [
      {
        path: typeof candidate.path === 'string' ? candidate.path : '',
        message: candidate.message,
      },
    ];
  });
}
