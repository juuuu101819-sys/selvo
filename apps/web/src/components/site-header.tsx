import { getTranslations } from 'next-intl/server';
import { MegaMenu } from '@/components/marketing/mega-menu';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { Link } from '@/i18n/navigation';
import { resolveOpenapiHref } from '@/lib/openapi-url';
import { readSessionToken } from '@/lib/session';
import { cn } from '@/lib/utils';

export async function SiteHeader({
  mode,
  engineVersion,
  organizationName,
  authLinks = 'default',
  showMegaMenu = true,
}: {
  mode: string | null;
  engineVersion: string | null;
  organizationName?: string | null;
  authLinks?: 'default' | 'none';
  showMegaMenu?: boolean;
}) {
  const signedIn = (await readSessionToken()) !== null;
  const t = await getTranslations('header');
  const tNav = await getTranslations('nav');
  const openapiHref = resolveOpenapiHref();

  return (
    <header className="border-border/60 bg-background/95 sticky top-0 isolate z-[50] border-b backdrop-blur-md">
      <div
        className={cn(
          'relative z-[51] mx-auto flex w-full max-w-7xl items-center gap-x-2 px-4 py-3 sm:gap-x-3 sm:px-6',
          showMegaMenu ? 'lg:gap-x-2' : 'justify-between',
        )}
      >
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <Link href="/" className="min-w-0 max-w-[11rem] leading-tight xl:max-w-[13rem]">
            <p className="text-sm font-semibold tracking-tight">Meridian</p>
            <p className="text-muted-foreground truncate text-xs">
              {organizationName ?? t('tagline')}
            </p>
          </Link>
        </div>

        {showMegaMenu ? (
          <MegaMenu
            openapiHref={openapiHref}
            className="hidden min-w-0 flex-1 justify-center overflow-visible lg:flex"
          />
        ) : null}

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1 sm:gap-1.5">
          {mode !== null && (
            <Badge
              variant={mode === 'sandbox' ? 'secondary' : 'default'}
              className="font-mono text-[10px] uppercase sm:text-[11px]"
            >
              {mode === 'sandbox' ? t('sandbox') : mode}
            </Badge>
          )}
          {engineVersion !== null && (
            <span className="text-muted-foreground hidden font-mono text-[11px] 2xl:inline">
              {t('engine', { version: engineVersion })}
            </span>
          )}
          <LocaleSwitcher compact={showMegaMenu} />
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
                variant="ghost"
                size="sm"
                nativeButton={false}
                render={<Link href="/login" />}
              >
                {showMegaMenu ? tNav('signIn') : t('signIn')}
              </Button>
            ))}
          {showMegaMenu && authLinks === 'default' && !signedIn ? (
            <Button
              size="sm"
              className="hidden xl:inline-flex"
              nativeButton={false}
              render={<Link href="/login" />}
            >
              {tNav('getKeys')}
            </Button>
          ) : null}
        </div>
      </div>
    </header>
  );
}
