import {
  FixedClock,
  RouteCostEngine,
  assertValidProviderQuote,
  buildQuoteRequest,
  isAppError,
  noopLogger,
  type CurrencyCode,
  type ProviderContext,
  type QuoteRequest,
  type RouteProvider,
} from '@meridian/core';

export interface ContractViolation {
  readonly providerId: string;
  readonly corridor: string;
  readonly rule: string;
  readonly detail: string;
}

export interface ContractCheckOptions {
  /** Corridors to exercise. Each is checked for both eligibility and quote validity. */
  readonly corridors: readonly {
    readonly source: CurrencyCode;
    readonly target: CurrencyCode;
    readonly amountMinorUnits: string;
  }[];
}

/**
 * Verifies that a `RouteProvider` upholds the adapter contract.
 *
 * Written as a plain function rather than a test suite so the same checks can run as a unit test
 * today and as a startup self-test or CI gate against a partner's sandbox in Phase 3. A live
 * adapter is held to exactly the same rules as the sandbox ones.
 */
export async function checkProviderContract(
  provider: RouteProvider,
  options: ContractCheckOptions,
): Promise<readonly ContractViolation[]> {
  const violations: ContractViolation[] = [];
  const engine = new RouteCostEngine();
  const clock = new FixedClock('2026-03-01T12:00:00.000Z');
  const context: ProviderContext = {
    clock,
    logger: noopLogger,
    requestId: 'contract-check',
    signal: undefined,
  };

  const record = (corridor: string, rule: string, detail: string): void => {
    violations.push({ providerId: provider.descriptor.id, corridor, rule, detail });
  };

  const { descriptor } = provider;
  if (descriptor.id.trim() === '') {
    record('-', 'descriptor.id must be non-empty', 'received an empty id');
  }
  if (descriptor.modes.length === 0) {
    record('-', 'descriptor.modes must list at least one mode', 'received an empty list');
  }
  if (descriptor.licensing === 'unlicensed_sandbox' && descriptor.modes.includes('production')) {
    record(
      '-',
      'unlicensed sandbox pricing must not be enabled for production',
      `modes: ${descriptor.modes.join(', ')}`,
    );
  }

  for (const corridor of options.corridors) {
    const label = `${corridor.source}->${corridor.target}`;
    const request: QuoteRequest = buildQuoteRequest({
      sourceCurrency: corridor.source,
      targetCurrency: corridor.target,
      amountMinorUnits: corridor.amountMinorUnits,
      requestedAt: clock.nowIso(),
    });

    if (!provider.supports(request)) {
      // Declining a corridor is legitimate; quoting one it declined is not.
      await provider
        .fetchQuote(request, context)
        .then(() => {
          record(
            label,
            'a provider that declines a corridor must not quote it',
            'supports() was false but fetchQuote() resolved',
          );
        })
        .catch(() => undefined);
      continue;
    }

    let quote;
    try {
      quote = await provider.fetchQuote(request, context);
    } catch (error) {
      record(
        label,
        'a supported corridor must produce a quote',
        isAppError(error) ? `${error.code}: ${error.message}` : String(error),
      );
      continue;
    }

    if (quote.providerId !== descriptor.id) {
      record(label, 'quote must be attributed to the provider', `got "${quote.providerId}"`);
    }
    if (quote.rail !== descriptor.rail) {
      record(label, 'quote rail must match the descriptor', `got "${quote.rail}"`);
    }
    if (quote.quotedAt !== clock.nowIso()) {
      record(
        label,
        'quote must be timestamped from the injected clock',
        `got "${quote.quotedAt}", expected "${clock.nowIso()}"`,
      );
    }
    if (quote.pricingVersion.trim() === '') {
      record(label, 'quote must declare a pricing version', 'received an empty version');
    }

    try {
      assertValidProviderQuote(quote, request);
    } catch (error) {
      record(
        label,
        'quote must satisfy the ProviderQuote contract',
        isAppError(error) ? `${error.code}: ${error.message}` : String(error),
      );
      continue;
    }

    try {
      const route = engine.price(request, quote, descriptor);
      if (!route.deliveredAmount.isPositive()) {
        record(label, 'a quote must deliver a positive amount', route.deliveredAmount.toString());
      }
      if (route.totalCost.isNegative()) {
        record(
          label,
          'all-in cost must not be negative against the mid-market benchmark',
          route.totalCost.toString(),
        );
      }
    } catch (error) {
      record(
        label,
        'quote must be priceable by the routing engine',
        isAppError(error) ? `${error.code}: ${error.message}` : String(error),
      );
    }
  }

  return violations;
}
