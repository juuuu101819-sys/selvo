import { Badge } from '@/components/ui/badge';

export function SiteHeader({
  mode,
  engineVersion,
}: {
  mode: string | null;
  engineVersion: string | null;
}) {
  return (
    <header className="border-border/60 bg-background/80 sticky top-0 z-30 border-b backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="flex size-8 shrink-0 items-center justify-center rounded-md bg-emerald-600 text-sm font-semibold text-white"
          >
            M
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold tracking-tight">Meridian</p>
            <p className="text-muted-foreground text-xs">Global financial routing</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {mode !== null && (
            <Badge
              variant={mode === 'sandbox' ? 'secondary' : 'default'}
              className="font-mono text-[11px] uppercase"
            >
              {mode}
            </Badge>
          )}
          {engineVersion !== null && (
            <span className="text-muted-foreground hidden font-mono text-[11px] sm:inline">
              engine {engineVersion}
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
