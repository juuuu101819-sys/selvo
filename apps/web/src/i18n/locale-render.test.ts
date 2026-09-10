import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import enMessages from '../../messages/en.json';
import { ComparisonForm } from '@/components/comparison-form';
import { EmptyState, ErrorState, ResultsSkeleton } from '@/components/states';
import type { AppLocale } from '@/i18n/locales';
import { comparisonErrorTitle, comparisonErrorTitleKey } from '@/lib/error-title';

const messagesDir = join(dirname(fileURLToPath(import.meta.url)), '../../messages');
const en = JSON.parse(readFileSync(join(messagesDir, 'en.json'), 'utf8')) as typeof enMessages;
const ko = JSON.parse(readFileSync(join(messagesDir, 'ko.json'), 'utf8')) as typeof enMessages;

function renderWithMessages(locale: AppLocale, messages: typeof enMessages, node: ReactElement): string {
  return renderToStaticMarkup(
    createElement(NextIntlClientProvider, { locale, messages, timeZone: 'UTC', children: node }),
  );
}

describe('locale render and catalog fallback', () => {
  it('renders EmptyState from the English catalog', () => {
    const html = renderWithMessages('en', en, createElement(EmptyState));
    expect(html).toContain(en.states.emptyTitle);
    expect(html).toContain('No comparison yet');
  });

  it('renders EmptyState from the Korean catalog', () => {
    const html = renderWithMessages('ko', ko, createElement(EmptyState));
    expect(html).toContain(ko.states.emptyTitle);
    expect(html).not.toContain(en.states.emptyTitle);
  });

  it('shows API_TIMEOUT display copy from the catalog while keeping the code value', () => {
    const html = renderWithMessages(
      'en',
      en,
      createElement(ErrorState, {
        failure: {
          code: 'API_TIMEOUT',
          message: 'The routing API did not respond in time.',
          details: {},
          requestId: null,
        },
      }),
    );
    expect(html).toContain('API_TIMEOUT');
    expect(html).toContain(en.errors.apiTimeout);
    expect(html).toContain('The routing API did not respond in time.');
  });

  it('shows API_UNREACHABLE and NO_ROUTES_AVAILABLE titles from the catalog', () => {
    const de = JSON.parse(readFileSync(join(messagesDir, 'de.json'), 'utf8')) as typeof enMessages;
    const unreachable = renderWithMessages(
      'de',
      de,
      createElement(ErrorState, {
        failure: {
          code: 'API_UNREACHABLE',
          message: 'connect ECONNREFUSED',
          details: {},
          requestId: 'req-1',
        },
      }),
    );
    expect(unreachable).toContain('API_UNREACHABLE');
    expect(unreachable).toContain(de.errors.apiUnreachable);

    const noRoutes = renderWithMessages(
      'fr',
      en,
      createElement(ErrorState, {
        failure: {
          code: 'NO_ROUTES_AVAILABLE',
          message: 'No provider returned a quote.',
          details: {},
          requestId: null,
        },
      }),
    );
    expect(noRoutes).toContain('NO_ROUTES_AVAILABLE');
    expect(noRoutes).toContain(en.errors.noRoutesAvailable);
  });

  it('keeps comparisonErrorTitle in lockstep with en.json errors', () => {
    const cases = [
      { code: 'API_TIMEOUT', details: {} },
      { code: 'API_UNREACHABLE', details: {} },
      { code: 'NO_ROUTES_AVAILABLE', details: {} },
    ] as const;
    for (const failure of cases) {
      const key = comparisonErrorTitleKey(failure);
      expect(comparisonErrorTitle(failure)).toBe(en.errors[key]);
    }
  });

  it('renders comparison form labels from the English and Korean catalogs', () => {
    const form = createElement(ComparisonForm, {
      currencies: [
        { code: 'USD', name: 'US Dollar', exponent: 2 },
        { code: 'KRW', name: 'Korean Won', exponent: 0 },
      ],
      rails: [
        {
          type: 'bank_fx',
          family: 'tradfi',
          label: 'Bank FX',
          description: 'Correspondent FX',
          status: 'available',
        },
      ],
      value: {
        sourceCurrency: 'USD',
        targetCurrency: 'KRW',
        amount: '100000.00',
        rails: [],
        priority: 'balanced',
      },
      isPending: false,
      onChange: () => undefined,
      onSubmit: () => undefined,
    });

    const enHtml = renderWithMessages('en', en, form);
    expect(enHtml).toContain(en.comparison.youSend);
    expect(enHtml).toContain(en.comparison.beneficiaryReceives);
    expect(enHtml).toContain(en.comparison.optimiseFor);
    expect(enHtml).toContain(en.comparison.compare);

    const koHtml = renderWithMessages('ko', ko, form);
    expect(koHtml).toContain(ko.comparison.youSend);
    expect(koHtml).not.toContain(en.comparison.youSend);
  });

  it('labels the results skeleton from the Japanese catalog', () => {
    const ja = JSON.parse(readFileSync(join(messagesDir, 'ja.json'), 'utf8')) as typeof enMessages;
    const html = renderWithMessages('ja', ja, createElement(ResultsSkeleton));
    expect(html).toContain(`aria-label="${ja.states.comparingRoutes}"`);
  });
});
