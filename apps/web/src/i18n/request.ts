import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import { DEFAULT_LOCALE, isAppLocale } from './locales';
import { routing } from './routing';
import enMessages from '../../messages/en.json';

type MessageTree = typeof enMessages;

function lookup(tree: unknown, path: string): string | undefined {
  let current: unknown = tree;
  for (const part of path.split('.')) {
    if (typeof current !== 'object' || current === null || !(part in current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'string' ? current : undefined;
}

async function loadMessages(locale: string): Promise<MessageTree> {
  if (locale === DEFAULT_LOCALE) {
    return enMessages;
  }
  if (!isAppLocale(locale)) {
    return enMessages;
  }
  try {
    return (await import(`../../messages/${locale}.json`)).default as MessageTree;
  } catch {
    return enMessages;
  }
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  const messages = await loadMessages(locale);

  return {
    locale,
    messages,
    timeZone: 'UTC',
    onError(error) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[i18n]', error.code, error.message);
      }
    },
    getMessageFallback({ namespace, key, error }) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[i18n] missing message, falling back to en', {
          locale,
          namespace,
          key,
          code: error.code,
        });
      }
      const path = [namespace, key].filter((part) => part !== undefined && part !== '').join('.');
      return lookup(enMessages, path) ?? path;
    },
  };
});
