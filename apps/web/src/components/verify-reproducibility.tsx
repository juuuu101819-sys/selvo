'use client';

import { CheckCircle2, Loader2, ShieldQuestion, XCircle } from 'lucide-react';
import { useState, useTransition } from 'react';
import { verifyComparison } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { shortFingerprint } from '@/lib/format';

type VerificationState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'reproduced'; readonly fingerprint: string }
  | { readonly kind: 'diverged'; readonly expected: string; readonly actual: string }
  | { readonly kind: 'error'; readonly message: string };

/**
 * Re-runs the stored comparison through the engine and reports whether it reproduced.
 *
 * This is the reproducibility guarantee made visible: the snapshot of the request and the raw
 * provider quotes is enough to re-derive the identical result and hash, however long afterwards and
 * whatever the market has done since.
 */
export function VerifyReproducibility({
  comparisonId,
  fingerprint,
}: {
  comparisonId: string;
  fingerprint: string;
}) {
  const [state, setState] = useState<VerificationState>({ kind: 'idle' });
  const [isPending, startTransition] = useTransition();

  const verify = (): void => {
    startTransition(async () => {
      const result = await verifyComparison(comparisonId);
      if (!result.ok) {
        setState({ kind: 'error', message: result.failure.message });
        return;
      }
      setState(
        result.data.reproducible
          ? { kind: 'reproduced', fingerprint: result.data.replayedFingerprint }
          : {
              kind: 'diverged',
              expected: result.data.originalFingerprint,
              actual: result.data.replayedFingerprint,
            },
      );
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" size="sm" variant="outline" onClick={verify} disabled={isPending}>
        {isPending ? (
          <>
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            Replaying…
          </>
        ) : (
          <>
            <ShieldQuestion className="size-3.5" aria-hidden />
            Verify reproducibility
          </>
        )}
      </Button>

      <span className="text-muted-foreground font-mono text-xs" title={fingerprint}>
        {shortFingerprint(fingerprint)}
      </span>

      <output aria-live="polite" className="text-xs">
        {state.kind === 'reproduced' && (
          <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="size-3.5" aria-hidden />
            Replayed to an identical result and fingerprint.
          </span>
        )}
        {state.kind === 'diverged' && (
          <span className="text-destructive inline-flex items-center gap-1">
            <XCircle className="size-3.5" aria-hidden />
            Replay produced {shortFingerprint(state.actual)}, expected{' '}
            {shortFingerprint(state.expected)}.
          </span>
        )}
        {state.kind === 'error' && (
          <span className="text-destructive inline-flex items-center gap-1">
            <XCircle className="size-3.5" aria-hidden />
            {state.message}
          </span>
        )}
      </output>
    </div>
  );
}
