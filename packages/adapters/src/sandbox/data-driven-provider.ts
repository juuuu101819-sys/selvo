import { createHash } from 'node:crypto';
import {
  type CurrencyCode,
  Dec,
  type Decimal,
  type FeeComponent,
  Money,
  type ProviderContext,
  type ProviderDescriptor,
  type ProviderQuote,
  ProviderError,
  type QuoteRequest,
  type Rate,
  Rounding,
  type RouteProvider,
  type SlippageModel,
  bpsToRatio,
} from '@meridian/core';
import type {
  CurrencyMatcher,
  FeeEntry,
  PricingProfile,
  SandboxProviderProfile,
} from '../data/schema.js';
import type { ReferenceRateSource } from '../reference-rates.js';

export interface SandboxProviderOptions {
  readonly profile: SandboxProviderProfile;
  readonly rates: ReferenceRateSource;
  readonly currencyGroups: Readonly<Record<string, readonly string[]>>;
  readonly pricingVersion: string;
}

type Assessment =
  | {
      readonly ok: true;
      readonly profile: PricingProfile;
      readonly midMarketRate: Rate;
      readonly notionalUsd: Decimal;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * A sandbox liquidity source priced entirely from an external dataset.
 *
 * There is no pricing constant in this class: spreads, fee schedules, settlement estimates and
 * slippage curves all come from the provider profile it was constructed with. The class's job is
 * to translate one provider's pricing conventions (USD-denominated fee book, tiered spreads,
 * corridor coverage rules) into the `ProviderQuote` primitives the engine consumes — which is
 * exactly the job a live partner adapter will have.
 */
export class DataDrivenSandboxProvider implements RouteProvider {
  readonly descriptor: ProviderDescriptor;
  private readonly profile: SandboxProviderProfile;
  private readonly rates: ReferenceRateSource;
  private readonly groups: Readonly<Record<string, readonly string[]>>;
  private readonly pricingVersion: string;

  constructor(options: SandboxProviderOptions) {
    this.profile = options.profile;
    this.rates = options.rates;
    this.groups = options.currencyGroups;
    this.pricingVersion = options.pricingVersion;

    this.descriptor = {
      id: this.profile.id,
      name: this.profile.name,
      rail: this.profile.rail,
      licensing: this.profile.licensing,
      // Sandbox pricing is never eligible for production mode; the registry enforces this too.
      modes: ['sandbox'],
      jurisdictions: this.profile.jurisdictions,
      description: this.profile.description,
      pricingVersion: options.pricingVersion,
    };
  }

  supports(request: QuoteRequest): boolean {
    return this.assess(request).ok;
  }

  fetchQuote(request: QuoteRequest, context: ProviderContext): Promise<ProviderQuote> {
    const assessment = this.assess(request);
    if (!assessment.ok) {
      // A provider that declined a corridor must never go on to price it, or the comparison would
      // contain a route the provider cannot actually offer.
      return Promise.reject(new ProviderError(this.descriptor.id, assessment.reason));
    }
    const { profile, midMarketRate, notionalUsd } = assessment;

    const spreadBps = this.resolveSpreadBps(profile, notionalUsd);
    // The offered rate is the mid rate less the provider's spread. This is the only place a
    // "price" is formed, and it is formed from dataset inputs.
    const offeredRate = midMarketRate.scaleBy(new Dec(1).minus(bpsToRatio(spreadBps)));

    const fees = this.resolveFees(profile.fees, request);
    if (fees === null) {
      return Promise.reject(
        new ProviderError(
          this.descriptor.id,
          'cannot denominate the fee schedule in this corridor',
        ),
      );
    }

    const slippageModel = this.resolveSlippage(profile, request);
    if (slippageModel === null) {
      return Promise.reject(
        new ProviderError(
          this.descriptor.id,
          'cannot express the slippage curve in the corridor currency',
        ),
      );
    }

    const quotedAt = context.clock.nowIso();
    const expiresAt = new Date(
      context.clock.nowMs() + this.profile.quoteTtlSeconds * 1000,
    ).toISOString();

    return Promise.resolve({
      providerId: this.descriptor.id,
      rail: this.descriptor.rail,
      quotedAt,
      expiresAt,
      quoteReference: this.buildQuoteReference(request, profile, spreadBps),
      sourceCurrency: request.sourceCurrency,
      targetCurrency: request.targetCurrency,
      midMarketRate: midMarketRate.value.toFixed(),
      offeredRate: offeredRate.value.toFixed(),
      fees: { components: fees },
      settlement: { ...profile.settlement },
      slippage: slippageModel,
      reliabilityScore: this.profile.reliabilityScore,
      intermediaryAsset: this.profile.intermediaryAsset,
      pricingVersion: this.pricingVersion,
      raw: {
        source: 'sandbox-dataset',
        datasetVersion: this.pricingVersion,
        referenceRatesVersion: this.rates.version,
        referenceRatesAsOf: this.rates.asOf,
        profileLabel: profile.label,
        spreadBps: spreadBps.toFixed(),
        notionalUsd: notionalUsd.toFixed(2),
        indicativeOnly: true,
      },
    });
  }

  /**
   * The single eligibility decision, shared by `supports` and `fetchQuote`.
   *
   * Keeping one implementation is what stops the two from drifting apart — a provider that says it
   * cannot serve a corridor and then quotes it anyway is worse than one that simply declines.
   */
  private assess(request: QuoteRequest): Assessment {
    if (!this.matches(this.profile.corridors.source, request.sourceCurrency)) {
      return { ok: false, reason: `${request.sourceCurrency} is not a supported source currency` };
    }
    if (!this.matches(this.profile.corridors.target, request.targetCurrency)) {
      return { ok: false, reason: `${request.targetCurrency} is not a supported target currency` };
    }

    const midMarketRate = this.rates.midRate(request.sourceCurrency, request.targetCurrency);
    if (midMarketRate === null) {
      return {
        ok: false,
        reason: `no reference rate for ${request.sourceCurrency}/${request.targetCurrency}`,
      };
    }

    const notionalUsd = this.toUsd(
      Money.ofMinorUnits(request.sourceCurrency, request.amountMinorUnits),
    );
    if (notionalUsd === null) {
      return { ok: false, reason: 'cannot value the notional in USD' };
    }

    const { min, max } = this.profile.notionalLimitsUsd;
    if (notionalUsd.lessThan(new Dec(min))) {
      return { ok: false, reason: `notional is below the USD ${min} minimum` };
    }
    if (notionalUsd.greaterThan(new Dec(max))) {
      return { ok: false, reason: `notional is above the USD ${max} maximum` };
    }

    const profile = this.findProfile(request);
    if (profile === null) {
      return { ok: false, reason: 'no pricing profile matches this corridor' };
    }

    return { ok: true, profile, midMarketRate, notionalUsd };
  }

  private findProfile(request: QuoteRequest): PricingProfile | null {
    return (
      this.profile.profiles.find(
        (candidate) =>
          this.matches(candidate.match.source, request.sourceCurrency) &&
          this.matches(candidate.match.target, request.targetCurrency),
      ) ?? null
    );
  }

  private matches(matcher: CurrencyMatcher, currency: CurrencyCode): boolean {
    if (matcher === '*') {
      return true;
    }
    if ('group' in matcher) {
      return (this.groups[matcher.group] ?? []).includes(currency);
    }
    return matcher.currencies.includes(currency);
  }

  private toUsd(amount: Money): Decimal | null {
    if (amount.currency === 'USD') {
      return amount.toDecimal();
    }
    const rate = this.rates.midRate(amount.currency, 'USD');
    return rate === null ? null : amount.toDecimal().times(rate.value);
  }

  private resolveSpreadBps(profile: PricingProfile, notionalUsd: Decimal): Decimal {
    if (profile.spread.kind === 'flat') {
      return new Dec(profile.spread.bps);
    }
    return this.resolveTierBps(profile.spread, notionalUsd);
  }

  private resolveTierBps(
    tiered: {
      notionalCurrency: string;
      tiers: readonly { upToAmount: string | null; bps: string }[];
    },
    notionalUsd: Decimal,
  ): Decimal {
    const notional = this.notionalInTierCurrency(tiered.notionalCurrency, notionalUsd);
    for (const tier of tiered.tiers) {
      if (tier.upToAmount === null || notional.lessThanOrEqualTo(new Dec(tier.upToAmount))) {
        return new Dec(tier.bps);
      }
    }
    // The schema requires an unbounded final tier, so this is unreachable for validated data.
    return new Dec(tiered.tiers.at(-1)?.bps ?? '0');
  }

  private notionalInTierCurrency(currency: string, notionalUsd: Decimal): Decimal {
    if (currency === 'USD') {
      return notionalUsd;
    }
    const rate = this.rates.midRate('USD', currency as CurrencyCode);
    return rate === null ? notionalUsd : notionalUsd.times(rate.value);
  }

  /**
   * Re-denominates the USD pricing book into the corridor's currencies.
   *
   * Doing this here rather than in the engine is deliberate: fee denomination is a provider
   * convention, and the engine should only ever receive fees it can value against the corridor.
   */
  private resolveFees(entries: readonly FeeEntry[], request: QuoteRequest): FeeComponent[] | null {
    const components: FeeComponent[] = [];

    for (const entry of entries) {
      const currency: CurrencyCode =
        entry.side === 'source' ? request.sourceCurrency : request.targetCurrency;

      if (entry.kind === 'fixed') {
        const amount = this.rates.convertFromUsd(entry.amountUsd, currency);
        if (amount === null) {
          return null;
        }
        components.push({
          kind: 'fixed',
          code: entry.code,
          label: entry.label,
          side: entry.side,
          currency,
          amountMinorUnits: amount.minorUnits.toString(),
        });
        continue;
      }

      const floor =
        entry.minAmountUsd === undefined
          ? null
          : this.rates.convertFromUsd(entry.minAmountUsd, currency);
      const cap =
        entry.maxAmountUsd === undefined
          ? null
          : this.rates.convertFromUsd(entry.maxAmountUsd, currency);
      if (
        (entry.minAmountUsd !== undefined && floor === null) ||
        (entry.maxAmountUsd !== undefined && cap === null)
      ) {
        return null;
      }

      components.push({
        kind: 'proportional',
        code: entry.code,
        label: entry.label,
        side: entry.side,
        rateBps: entry.rateBps,
        minAmountMinorUnits: floor === null ? null : floor.minorUnits.toString(),
        maxAmountMinorUnits: cap === null ? null : cap.minorUnits.toString(),
      });
    }

    return components;
  }

  /**
   * Restates the slippage curve in the corridor's source currency.
   *
   * The dataset denominates tier thresholds in the currency the provider's liquidity book uses,
   * usually USD. The engine can only value a notional against the corridor's own mid rate, so the
   * translation belongs here, where the reference rates are available — the same reason the fee
   * book is re-denominated rather than passed through.
   */
  private resolveSlippage(profile: PricingProfile, request: QuoteRequest): SlippageModel | null {
    if (profile.slippage.kind === 'none') {
      return { kind: 'none' };
    }

    const bookCurrency = profile.slippage.notionalCurrency as CurrencyCode;
    const target = request.sourceCurrency;
    const conversion =
      bookCurrency === target ? new Dec(1) : this.rates.midRate(bookCurrency, target)?.value;
    if (conversion === undefined) {
      return null;
    }

    return {
      kind: 'tiered',
      notionalCurrency: target,
      tiers: profile.slippage.tiers.map((tier) => ({
        upToNotionalMinorUnits:
          tier.upToAmount === null
            ? null
            : Money.fromDecimal(
                target,
                new Dec(tier.upToAmount).times(conversion),
                Rounding.HALF_UP,
              ).minorUnits.toString(),
        bps: tier.bps,
      })),
    };
  }

  /**
   * A stable reference for this exact price.
   *
   * Real providers return an opaque id. Deriving it from the pricing inputs instead means the same
   * corridor, size and dataset always yields the same reference, which makes a demo or a
   * regression fixture diffable while still giving operations something to quote upstream.
   */
  private buildQuoteReference(
    request: QuoteRequest,
    profile: PricingProfile,
    spreadBps: Decimal,
  ): string {
    const digest = createHash('sha256')
      .update(
        [
          this.descriptor.id,
          this.pricingVersion,
          this.rates.version,
          request.sourceCurrency,
          request.targetCurrency,
          request.amountMinorUnits,
          profile.label,
          spreadBps.toFixed(),
        ].join('|'),
        'utf8',
      )
      .digest('hex');
    return `sbx-${digest.slice(0, 12)}`;
  }
}
