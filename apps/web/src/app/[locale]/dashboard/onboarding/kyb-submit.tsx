'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { submitKybForReview } from '@/app/actions';
import { Button } from '@/components/ui/button';

export function KybSubmitForm() {
  const t = useTranslations('onboarding');
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
      <p className="text-muted-foreground text-sm">{t('kybSubmitBody')}</p>
      {error !== null && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? t('submitting') : t('submitKyb')}
      </Button>
    </form>
  );
}
