import { Badge } from '@/components/ui/badge';
import {
  isUnlicensedSandbox,
  providerLicensingHint,
  providerLicensingLabel,
} from '@/lib/licensing';

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
  const label = providerLicensingLabel(licensing);
  const hint = providerLicensingHint(licensing);
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
      {label}
    </Badge>
  );
}
