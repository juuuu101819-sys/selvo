'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { completeSsoSignIn } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { safeDashboardPath } from '@/lib/session-cookie';

export function SsoCallbackClient({
  code,
  state,
  nextPath,
  errorDescription,
}: {
  readonly code: string | null;
  readonly state: string | null;
  readonly nextPath: string;
  readonly errorDescription: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(errorDescription);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (code === null || state === null || errorDescription !== null) {
      return;
    }
    startTransition(async () => {
      const result = await completeSsoSignIn(code, state, safeDashboardPath(nextPath));
      if (!result.ok) {
        setError(result.failure.message);
      }
    });
  }, [code, state, nextPath, errorDescription]);

  if (error !== null) {
    return (
      <div className="space-y-4">
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
        <Button type="button" variant="outline" onClick={() => router.push('/login')}>
          Back to sign in
        </Button>
      </div>
    );
  }

  return <p className="text-sm">{pending ? 'Completing organization SSO…' : 'Redirecting…'}</p>;
}
