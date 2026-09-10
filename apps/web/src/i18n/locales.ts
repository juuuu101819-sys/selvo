export const LOCALES = ['en', 'ko', 'ja', 'zh-CN', 'es', 'fr', 'de', 'pt-BR'] as const;

export type AppLocale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = 'en';

/** Preference cookie set when a visitor picks a language or when the middleware negotiates one. */
export const LOCALE_COOKIE = 'meridian_locale';

export const LOCALE_SET: ReadonlySet<string> = new Set(LOCALES);

export function isAppLocale(value: string): value is AppLocale {
  return LOCALE_SET.has(value);
}
