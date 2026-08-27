import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { readSessionToken } from '@/lib/session';

export async function SiteHeader({
  mode,
  engineVersion,
  organizationName,
  authLinks = 'default',
}: {
  mode: string | null;
  engineVersion: string | null;
  organizationName?: string | null;
  authLinks?: 'default' | 'none';
}) {
  const signedIn = (await readSessionToken()) !== null;

  return (
    <header className="border-border/60 bg-background/80 sticky top-0 z-30 border-b backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/" className="flex items-center gap-3">
            <span
              aria-hidden
              className="flex size-8 shrink-0 items-center justify-center rounded-md bg-emerald-600 text-sm font-semibold text-white"
            >
              M
            </span>
            <div className="leading-tight">
              <p className="text-sm font-semibold tracking-tight">Meridian</p>
              <p className="text-muted-foreground truncate text-xs">
                {organizationName ?? 'Global financial routing'}
              </p>
            </div>
          </Link>
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
          {authLinks === 'default' &&
            (signedIn ? (
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<Link href="/dashboard" />}
              >
                Dashboard
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<Link href="/login" />}
              >
                Sign in
              </Button>
            ))}
          <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/rails" />}>
            Multi-rail
          </Button>
        </div>
      </div>
    </header>
  );
}
