import { AlertCircle, Route, ServerCrash } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import type { ApiFailure } from '@/lib/api/types';

/** Shown before the first comparison: explains the product rather than showing a blank panel. */
export function EmptyState() {
  return (
    <div className="border-border/60 rounded-xl border border-dashed p-8 text-center">
      <Route className="text-muted-foreground mx-auto size-8" aria-hidden />
      <h2 className="mt-3 text-base font-semibold">No comparison yet</h2>
      <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
        Enter an amount and a currency pair to compare bank FX, payment institution, stablecoin and
        wholesale liquidity routes side by side. Every route is priced against the mid-market rate,
        so the all-in cost is comparable.
      </p>
    </div>
  );
}

export function ResultsSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Comparing routes">
      <Skeleton className="h-64 w-full rounded-xl" />
      <div className="space-y-3">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-36 w-full rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-40 w-full rounded-xl" />
    </div>
  );
}

/**
 * Failure display.
 *
 * An unreachable API and a rejected request are different problems with different fixes, so they
 * get different messages: one tells you to start the server, the other tells you what was wrong
 * with the input.
 */
export function ErrorState({ failure }: { failure: ApiFailure }) {
  const unreachable = failure.code === 'API_UNREACHABLE' || failure.code === 'API_TIMEOUT';
  const issues = extractIssues(failure.details);

  return (
    <Alert variant="destructive">
      {unreachable ? <ServerCrash aria-hidden /> : <AlertCircle aria-hidden />}
      <AlertTitle>{unreachable ? 'Routing API unavailable' : titleFor(failure.code)}</AlertTitle>
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

function titleFor(code: string): string {
  switch (code) {
    case 'VALIDATION_ERROR':
      return 'Check the request';
    case 'UNSUPPORTED_CORRIDOR':
      return 'No route for this corridor';
    case 'NO_ROUTES_AVAILABLE':
      return 'No provider could quote';
    default:
      return 'Comparison failed';
  }
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
