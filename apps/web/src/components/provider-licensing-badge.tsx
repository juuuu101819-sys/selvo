'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { isUnlicensedSandbox } from '@/lib/licensing';

function licensingKey(licensing: string | undefined): 'sandbox' | 'licensedPartner' | 'internalModel' | 'unknown' {
  if (licensing === undefined || licensing === 'unlicensed_sandbox') {
    return 'sandbox';
  }
  if (licensing === 'licensed_partner') {
    return 'licensedPartner';
  }
  if (licensing === 'internal_model') {
    return 'internalModel';
  }
  return 'unknown';
}

/**
 * Visual distinction for sandbox/demo vs licensed sources (PHASE 30 / PHASE 38).
 *
 * Copy matches the API `licensing` labels. PHASE 30 must re-verify both states on one screen
 * when a real licensed provider exists.
 */
export function ProviderLicensingBadge({
  licensing,
}: {
  readonly licensing: string | undefined;
}) {
  const t = useTranslations('licensing');
  const key = licensingKey(licensing);
  const hintKey = (
    {
      sandbox: 'sandboxHint',
      licensedPartner: 'licensedHint',
      internalModel: 'internalHint',
      unknown: 'unknownHint',
    } as const
  )[key];
  const hint = t(hintKey);
  const sandbox = isUnlicensedSandbox(licensing);

  return (
    <Badge
      variant={sandbox ? 'secondary' : 'outline'}
      title={hint}
      aria-label={hint}
      className={
        sandbox
          ? 'border-amber-500/40 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
          : undefined
      }
    >
      {t(key)}
    </Badge>
  );
}
