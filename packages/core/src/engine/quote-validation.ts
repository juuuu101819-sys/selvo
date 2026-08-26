import type { ProviderQuote, QuoteRequest, SlippageModel } from '../domain/index.js';
import { InvalidProviderQuoteError } from '../errors/index.js';
import { type Decimal, isCurrencyCode, toDecimal } from '../money/index.js';

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const INTEGER_STRING = /^-?\d+$/;

/**
 * Guards the adapter boundary. A provider is an external system, so nothing it returns is
 * trusted: an adapter bug or an upstream contract change must surface as a clear
 * `INVALID_PROVIDER_QUOTE` for that one provider rather than corrupting a comparison.
 */
export function assertValidProviderQuote(quote: ProviderQuote, request: QuoteRequest): void {
  const fail = (reason: string, details: Record<string, unknown> = {}): never => {
    throw new InvalidProviderQuoteError(quote.providerId, reason, details);
  };

  if (quote.sourceCurrency !== request.sourceCurrency) {
    fail('quoted source currency does not match the request', {
      quoted: quote.sourceCurrency,
      requested: request.sourceCurrency,
    });
  }
  if (quote.targetCurrency !== request.targetCurrency) {
    fail('quoted target currency does not match the request', {
      quoted: quote.targetCurrency,
      requested: request.targetCurrency,
    });
  }
  if (!ISO_INSTANT.test(quote.quotedAt)) {
    fail('quotedAt is not an ISO-8601 instant', { quotedAt: quote.quotedAt });
  }
  if (Number.isNaN(new Date(quote.quotedAt).getTime())) {
    fail('quotedAt is not a valid instant', { quotedAt: quote.quotedAt });
  }
  if (quote.expiresAt !== null && !ISO_INSTANT.test(quote.expiresAt)) {
    fail('expiresAt is not an ISO-8601 instant', { expiresAt: quote.expiresAt });
  }
  if (quote.providerId.trim() === '') {
    fail('providerId is empty');
  }

  for (const field of ['midMarketRate', 'offeredRate'] as const) {
    const value = toDecimalOrFail(quote[field], () => fail(`${field} is not a decimal`));
    if (!value.isFinite() || value.lessThanOrEqualTo(0)) {
      fail(`${field} must be a positive finite decimal`, { [field]: quote[field] });
    }
  }

  const reliability = toDecimalOrFail(quote.reliabilityScore, () =>
    fail('reliabilityScore is not a decimal'),
  );
  if (reliability.lessThan(0) || reliability.greaterThan(1)) {
    fail('reliabilityScore must be between 0 and 1 inclusive', {
      reliabilityScore: quote.reliabilityScore,
    });
  }

  const { p50Seconds, p95Seconds } = quote.settlement;
  if (!Number.isInteger(p50Seconds) || p50Seconds < 0) {
    fail('settlement.p50Seconds must be a non-negative integer', { p50Seconds });
  }
  if (!Number.isInteger(p95Seconds) || p95Seconds < p50Seconds) {
    fail('settlement.p95Seconds must be an integer not below p50Seconds', {
      p50Seconds,
      p95Seconds,
    });
  }

  for (const component of quote.fees.components) {
    if (component.kind === 'fixed') {
      if (!isCurrencyCode(component.currency)) {
        fail('fixed fee uses an unsupported currency', { code: component.code });
      }
      if (!INTEGER_STRING.test(component.amountMinorUnits)) {
        fail('fixed fee amount is not an integer minor-unit string', { code: component.code });
      }
      if (component.amountMinorUnits.startsWith('-')) {
        fail('fixed fee amount must not be negative', { code: component.code });
      }
    } else {
      const bps = toDecimalOrFail(component.rateBps, () =>
        fail('proportional fee rateBps is not a decimal', { code: component.code }),
      );
      if (bps.isNegative()) {
        fail('proportional fee rateBps must not be negative', { code: component.code });
      }
    }
  }

  assertValidSlippageModel(quote, fail);
}

function assertValidSlippageModel(
  quote: ProviderQuote,
  fail: (reason: string, details?: Record<string, unknown>) => never,
): void {
  const model: SlippageModel = quote.slippage;
  if (model.kind === 'none') {
    return;
  }
  if (!isCurrencyCode(model.notionalCurrency)) {
    fail('slippage notionalCurrency is unsupported', { currency: model.notionalCurrency });
  }
  if (model.tiers.length === 0) {
    fail('tiered slippage model has no tiers');
  }

  let previousThreshold: bigint | null = null;
  model.tiers.forEach((tier, index) => {
    const bps = toDecimalOrFail(tier.bps, () => fail('slippage tier bps is not a decimal', { index }));
    if (bps.isNegative()) {
      fail('slippage tier bps must not be negative', { index });
    }
    const isLast = index === model.tiers.length - 1;
    if (tier.upToNotionalMinorUnits === null) {
      if (!isLast) {
        fail('only the final slippage tier may be unbounded', { index });
      }
      return;
    }
    if (!INTEGER_STRING.test(tier.upToNotionalMinorUnits)) {
      fail('slippage tier threshold is not an integer minor-unit string', { index });
    }
    const threshold = BigInt(tier.upToNotionalMinorUnits);
    if (previousThreshold !== null && threshold <= previousThreshold) {
      fail('slippage tiers must be sorted ascending by threshold', { index });
    }
    previousThreshold = threshold;
  });
}

function toDecimalOrFail(value: string, onError: () => never): Decimal {
  try {
    return toDecimal(value);
  } catch {
    return onError();
  }
}
