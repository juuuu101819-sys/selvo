import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Fraunces, Geist_Mono, Inter } from 'next/font/google';
import { TooltipProvider } from '@/components/ui/tooltip';
import { getPathname } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  display: 'swap',
});

/** Display face for headings. Latin-only; `--font-display-stack` supplies the CJK fallback. */
const fraunces = Fraunces({
  variable: '--font-fraunces',
  subsets: ['latin'],
  style: ['normal', 'italic'],
  display: 'swap',
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
  display: 'swap',
});

type Props = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: Pick<Props, 'params'>): Promise<Metadata> {
  const { locale } = await params;
  const resolved = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: resolved, namespace: 'meta' });
  const title = t('title');
  const description = t('description');
  const languages: Record<string, string> = { 'x-default': '/' };
  for (const code of routing.locales) {
    languages[code] = getPathname({ href: '/', locale: code });
  }

  return {
    metadataBase: new URL(process.env.PUBLIC_WEB_ORIGIN ?? 'http://127.0.0.1:43117'),
    title: {
      default: title,
      template: t('titleTemplate'),
    },
    description,
    applicationName: 'Meridian',
    alternates: {
      canonical: getPathname({ href: '/', locale: resolved }),
      languages,
    },
    openGraph: {
      title,
      description,
      type: 'website',
      siteName: 'Meridian',
      locale: resolved === 'en' ? 'en_US' : resolved.replace('-', '_'),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  };
}

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  return (
    <html
      lang={locale}
      className={`${inter.variable} ${fraunces.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="bg-background text-foreground flex min-h-full flex-col">
        <NextIntlClientProvider>
          <TooltipProvider delay={200}>{children}</TooltipProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
