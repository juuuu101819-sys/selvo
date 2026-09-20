'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { usePathname, useRouter } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import type { AppLocale } from '@/i18n/locales';
import { cn } from '@/lib/utils';

const NATIVE_LABELS: Record<AppLocale, string> = {
  en: 'English',
  ko: '한국어',
  ja: '日本語',
  'zh-CN': '简体中文',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  'pt-BR': 'Português (Brasil)',
};

export function LocaleSwitcher({ compact = false }: { compact?: boolean }) {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations('header');
  const [pending, startTransition] = useTransition();

  return (
    <label className="text-muted-foreground flex items-center gap-1 text-[11px]">
      <span className={compact ? 'sr-only' : 'sr-only sm:not-sr-only sm:inline'}>
        {t('language')}
      </span>
      <select
        aria-label={t('language')}
        className={cn(
          'border-border bg-background h-7 rounded-md border px-1 text-[11px] text-foreground',
          compact ? 'max-w-[6.75rem]' : 'max-w-[9.5rem] px-1.5',
        )}
        disabled={pending}
        value={locale}
        onChange={(event) => {
          const next = event.target.value as AppLocale;
          startTransition(() => {
            router.replace(pathname, { locale: next });
          });
        }}
      >
        {routing.locales.map((code) => (
          <option key={code} value={code}>
            {NATIVE_LABELS[code]}
          </option>
        ))}
      </select>
    </label>
  );
}
