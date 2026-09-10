import { getTranslations } from 'next-intl/server';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { Link } from '@/i18n/navigation';
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
  const t = await getTranslations('header');

  return (
    <header className="border-border/60 bg-background/80 sticky top-0 z-30 border-b backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
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
                {organizationName ?? t('tagline')}
              </p>
            </div>
          </Link>
        </div>

        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          {mode !== null && (
            <Badge
              variant={mode === 'sandbox' ? 'secondary' : 'default'}
              className="font-mono text-[11px] uppercase"
            >
              {mode === 'sandbox' ? t('sandbox') : mode}
            </Badge>
          )}
          {engineVersion !== null && (
            <span className="text-muted-foreground hidden font-mono text-[11px] sm:inline">
              {t('engine', { version: engineVersion })}
            </span>
          )}
          <LocaleSwitcher />
          {authLinks === 'default' &&
            (signedIn ? (
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<Link href="/dashboard" />}
              >
                {t('dashboard')}
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<Link href="/login" />}
              >
                {t('signIn')}
              </Button>
            ))}
          <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/rails" />}>
            {t('navRails')}
          </Button>
          <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/graph" />}>
            {t('navGraph')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<Link href="/stablecoins" />}
          >
            {t('navStablecoins')}
          </Button>
          <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/defi" />}>
            {t('navDefi')}
          </Button>
          <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/agents" />}>
            {t('navAgents')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<Link href="/developers" />}
          >
            {t('navApi')}
          </Button>
        </div>
      </div>
    </header>
  );
}
