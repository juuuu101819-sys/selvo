import {
  type CurrencyCode,
  Dec,
  Money,
  Rate,
  Rounding,
  isCurrencyCode,
  type Decimal,
} from '@meridian/core';
import type { ReferenceRatesData } from './data/schema.js';

/**
 * Source of mid-market reference rates.
 *
 * The routing engine measures every route's cost against the mid rate, so this is the benchmark
 * the whole comparison hangs on. It is a port: the sandbox reads a versioned snapshot file, while
 * a live deployment would front a market data feed with the same interface.
 */
export interface ReferenceRateSource {
  readonly version: string;
  readonly asOf: string;
  readonly currencies: readonly CurrencyCode[];
  /** Mid-market rate for the corridor, or `null` when either leg is not covered. */
  midRate(source: CurrencyCode, target: CurrencyCode): Rate | null;
  /** Values a USD-denominated pricing-book figure in another currency. */
  convertFromUsd(amountUsd: Decimal | string, target: CurrencyCode): Money | null;
}

export class StaticReferenceRateSource implements ReferenceRateSource {
  readonly version: string;
  readonly asOf: string;
  readonly currencies: readonly CurrencyCode[];
  readonly disclaimer: string;
  private readonly baseCurrency: CurrencyCode;
  private readonly unitsPerBase: ReadonlyMap<CurrencyCode, Decimal>;

  constructor(data: ReferenceRatesData) {
    this.version = data.version;
    this.asOf = data.asOf;
    this.disclaimer = data.disclaimer;
    this.baseCurrency = data.baseCurrency as CurrencyCode;

    const entries = Object.entries(data.unitsPerBase).flatMap<[CurrencyCode, Decimal]>(
      ([code, value]) =>
        isCurrencyCode(code) && value !== undefined ? [[code, new Dec(value)]] : [],
    );
    this.unitsPerBase = new Map(entries);
    this.currencies = [...this.unitsPerBase.keys()].sort();
  }

  /**
   * Derives the cross rate through the base currency: `target per base / source per base`.
   *
   * Triangulating through one base keeps the dataset to N entries instead of N^2, and guarantees
   * the cross rates are internally consistent — USD/KRW divided by USD/JPY always equals JPY/KRW,
   * so a corridor cannot be arbitraged against itself by a rounding artefact in the data.
   */
  midRate(source: CurrencyCode, target: CurrencyCode): Rate | null {
    const sourcePerBase = this.unitsPerBase.get(source);
    const targetPerBase = this.unitsPerBase.get(target);
    if (sourcePerBase === undefined || targetPerBase === undefined || sourcePerBase.isZero()) {
      return null;
    }
    return Rate.of(source, target, targetPerBase.div(sourcePerBase));
  }

  convertFromUsd(amountUsd: Decimal | string, target: CurrencyCode): Money | null {
    if (target === 'USD') {
      return Money.fromDecimal('USD', amountUsd, Rounding.HALF_UP);
    }
    const rate = this.midRate('USD', target);
    if (rate === null) {
      return null;
    }
    return Money.fromDecimal(target, rate.value.times(new Dec(amountUsd)), Rounding.HALF_UP);
  }

  get base(): CurrencyCode {
    return this.baseCurrency;
  }
}
