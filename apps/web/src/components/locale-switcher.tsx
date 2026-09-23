import { cn } from '@/lib/utils';

/** Static English-only label — locale switching is not offered in the UI yet. */
export function LocaleSwitcher({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={cn(
        'text-muted-foreground border-border inline-flex h-7 shrink-0 items-center rounded-md border px-2 text-[11px] font-medium',
        compact ? 'font-mono uppercase tracking-wide' : 'px-2.5',
      )}
      aria-label="English (only supported language)"
    >
      {compact ? 'EN' : 'English'}
    </span>
  );
}
