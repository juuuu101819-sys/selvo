import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { TooltipProvider } from '@/components/ui/tooltip';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

const title = 'Meridian — Global financial routing';
const description =
  'Non-custodial routing hub for businesses and AI agents: compare traditional finance, ' +
  'stablecoin and wholesale liquidity routes. Meridian never holds funds or keys and ' +
  'does not execute, settle, or custody funds.';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.PUBLIC_WEB_ORIGIN ?? 'http://127.0.0.1:43117'),
  title: {
    default: title,
    template: '%s · Meridian',
  },
  description,
  applicationName: 'Meridian',
  openGraph: {
    title,
    description,
    type: 'website',
    siteName: 'Meridian',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="bg-background text-foreground flex min-h-full flex-col">
        <TooltipProvider delay={200}>{children}</TooltipProvider>
      </body>
    </html>
  );
}
