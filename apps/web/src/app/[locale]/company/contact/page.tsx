import { getTranslations } from 'next-intl/server';
import { ContactForm } from '@/components/marketing/contact-form';
import { MarketingPageShell } from '@/components/marketing/marketing-page-shell';
import { PageHero } from '@/components/marketing/page-hero';

export default async function ContactPage() {
  const t = await getTranslations('pages.contact');

  return (
    <MarketingPageShell noticeKey="marketingNotice">
      <PageHero title={t('heroTitle')} lede={t('heroLede')} />
      <ContactForm />
    </MarketingPageShell>
  );
}
