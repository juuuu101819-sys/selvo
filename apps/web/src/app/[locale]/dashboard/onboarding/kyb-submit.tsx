'use client';

import { useState, useTransition } from 'react';
import { submitKybForReview } from '@/app/actions';
import { Button } from '@/components/ui/button';

export function KybSubmitForm() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await submitKybForReview();
          if (!result.ok) {
            setError(result.failure.message);
          }
        });
      }}
    >
      <p className="text-muted-foreground text-sm">
        Submit this organization for manual Know-Your-Business review. No vendor is contractually
        confirmed yet, so an operator records verified or rejected with an audited reason. A vendor
        failure never auto-approves.
      </p>
      {error !== null && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? 'Submitting…' : 'Submit for KYB review'}
      </Button>
    </form>
  );
}
