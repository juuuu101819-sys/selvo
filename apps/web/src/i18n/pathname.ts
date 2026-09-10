import { DEFAULT_LOCALE, LOCALES, type AppLocale } from './locales';

/**
 * Locale-prefix helpers that do not import next-intl.
 *
 * Default English has no prefix (`localePrefix: 'as-needed'`). Other locales use `/{locale}/...`.
 * `zh-CN` and `pt-BR` are single path segments.
 */
export function stripLocalePrefix(pathname: string): string {
  for (const locale of LOCALES) {
    if (locale === DEFAULT_LOCALE) {
      continue;
    }
    const prefix = `/${locale}`;
    if (pathname === prefix) {
      return '/';
    }
    if (pathname.startsWith(`${prefix}/`)) {
      const rest = pathname.slice(prefix.length);
      return rest === '' ? '/' : rest;
    }
  }
  return pathname;
}

export function localeFromPathname(pathname: string): AppLocale {
  for (const locale of LOCALES) {
    if (locale === DEFAULT_LOCALE) {
      continue;
    }
    if (pathname === `/${locale}` || pathname.startsWith(`/${locale}/`)) {
      return locale;
    }
  }
  return DEFAULT_LOCALE;
}

export function withLocalePrefix(pathname: string, locale: AppLocale): string {
  const inner = pathname.startsWith('/') ? pathname : `/${pathname}`;
  if (locale === DEFAULT_LOCALE) {
    return inner;
  }
  if (inner === '/') {
    return `/${locale}`;
  }
  return `/${locale}${inner}`;
}

export function isDashboardPath(pathname: string): boolean {
  const inner = stripLocalePrefix(pathname);
  return inner === '/dashboard' || inner.startsWith('/dashboard/');
}

export function loginPathFor(pathname: string): string {
  return withLocalePrefix('/login', localeFromPathname(pathname));
}
