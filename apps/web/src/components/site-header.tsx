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
  organizationName: _organizationName,
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
          'relative z-[51] mx-auto flex w-full max-w-7xl items-center gap-x-3 px-4 py-2.5 sm:gap-x-4 sm:px-6 sm:py-3',
          showMegaMenu ? 'lg:gap-x-2' : 'justify-between',
        )}
      >
        <div className="flex shrink-0 items-center">
          <Link
            href="/"
            className="font-display block leading-none tracking-tight"
            aria-label="Meridian home"
          >
            <span className="bg-gradient-to-br from-foreground from-40% to-primary bg-clip-text text-2xl font-semibold text-transparent sm:text-[1.75rem] lg:text-3xl">
              Meridian
            </span>
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
