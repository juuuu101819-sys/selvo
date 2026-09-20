'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function ContactForm() {
  const t = useTranslations('pages.contact');
  const [submitted, setSubmitted] = useState(false);

  if (submitted) {
    return (
      <p className="text-muted-foreground marketing-surface rounded-xl p-6 text-sm">
        {t('formSuccess')}
      </p>
    );
  }

  return (
    <form
      className="marketing-surface space-y-4 rounded-xl p-6"
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
      }}
    >
      <div className="space-y-2">
        <label htmlFor="contact-name" className="text-sm font-medium">
          {t('formName')}
        </label>
        <Input id="contact-name" name="name" required autoComplete="name" />
      </div>
      <div className="space-y-2">
        <label htmlFor="contact-company" className="text-sm font-medium">
          {t('formCompany')}
        </label>
        <Input id="contact-company" name="company" autoComplete="organization" />
      </div>
      <div className="space-y-2">
        <label htmlFor="contact-message" className="text-sm font-medium">
          {t('formMessage')}
        </label>
        <textarea
          id="contact-message"
          name="message"
          required
          rows={4}
          className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex min-h-[80px] w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
        />
      </div>
      <p className="text-muted-foreground text-xs">{t('formHint')}</p>
      <Button type="submit">{t('formSubmit')}</Button>
    </form>
  );
}
