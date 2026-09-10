import { defineRouting } from 'next-intl/routing';
import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALES } from './locales';

export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: 'as-needed',
  localeDetection: true,
  alternateLinks: true,
  localeCookie: {
    name: LOCALE_COOKIE,
    sameSite: 'lax',
    path: '/',
  },
});
