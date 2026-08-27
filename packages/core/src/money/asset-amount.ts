import { CurrencyMismatchError, InvalidAmountError } from '../errors/index.js';
import { assetDefinition, assetExponent } from '../domain/asset.js';
import {
  Dec,
  type Decimal,
  type DecimalInput,
  Rounding,
  type RoundingMode,
  toDecimal,
} from './decimal.js';

export interface AssetAmountJson {
  readonly asset: string;
  /** Authoritative value: an exact integer count of the asset's minor units, as a string. */
  readonly minorUnits: string;
  /** Display convenience, derived from `minorUnits`. Never used as an input to arithmetic. */
  readonly decimal: string;
  readonly exponent: number;
}

/**
 * An exact amount of any registered asset (ISO fiat, USDC, ETH).
 *
 * {@link Money} stays ISO-4217-only so the comparison engine never sees a ticker stuffed into a
 * currency code. This type is the routing engine's equivalent: same integer minor-units model,
 * same explicit rounding, no binary floats.
 */
export class AssetAmount {
  readonly asset: string;
  readonly minorUnits: bigint;

  private constructor(asset: string, minorUnits: bigint) {
    this.asset = asset;
    this.minorUnits = minorUnits;
    Object.freeze(this);
  }

  static ofMinorUnits(asset: string, minorUnits: bigint | string): AssetAmount {
    assetDefinition(asset);
    const value =
      typeof minorUnits === 'bigint' ? minorUnits : AssetAmount.parseMinorUnits(minorUnits);
    return new AssetAmount(asset, value);
  }

  static zero(asset: string): AssetAmount {
    assetDefinition(asset);
    return new AssetAmount(asset, 0n);
  }

  static fromDecimal(
    asset: string,
    value: DecimalInput,
    rounding: RoundingMode = Rounding.HALF_UP,
  ): AssetAmount {
    const exponent = assetExponent(asset);
    const scaled = toDecimal(value).times(new Dec(10).pow(exponent));
    const integral = scaled.toDecimalPlaces(0, rounding);
    return new AssetAmount(asset, BigInt(integral.toFixed(0)));
  }

  private static parseMinorUnits(raw: string): bigint {
    if (!/^-?\d+$/.test(raw.trim())) {
      throw new InvalidAmountError(`Minor units must be an integer string, received "${raw}".`, {
        value: raw,
      });
    }
    return BigInt(raw.trim());
  }

  get exponent(): number {
    return assetExponent(this.asset);
  }

  toDecimal(): Decimal {
    return new Dec(this.minorUnits.toString()).div(new Dec(10).pow(this.exponent));
  }

  add(other: AssetAmount): AssetAmount {
    this.assertSameAsset(other, 'add');
    return new AssetAmount(this.asset, this.minorUnits + other.minorUnits);
  }

  subtract(other: AssetAmount): AssetAmount {
    this.assertSameAsset(other, 'subtract');
    return new AssetAmount(this.asset, this.minorUnits - other.minorUnits);
  }

  multiplyByRatio(ratio: DecimalInput, rounding: RoundingMode = Rounding.HALF_UP): AssetAmount {
    const product = new Dec(this.minorUnits.toString()).times(toDecimal(ratio));
    return new AssetAmount(
      this.asset,
      BigInt(product.toDecimalPlaces(0, rounding).toFixed(0)),
    );
  }

  isZero(): boolean {
    return this.minorUnits === 0n;
  }

  isNegative(): boolean {
    return this.minorUnits < 0n;
  }

  isPositive(): boolean {
    return this.minorUnits > 0n;
  }

  compareTo(other: AssetAmount): -1 | 0 | 1 {
    this.assertSameAsset(other, 'compare');
    if (this.minorUnits < other.minorUnits) return -1;
    if (this.minorUnits > other.minorUnits) return 1;
    return 0;
  }

  equals(other: AssetAmount): boolean {
    return this.asset === other.asset && this.minorUnits === other.minorUnits;
  }

  lessThan(other: AssetAmount): boolean {
    return this.compareTo(other) < 0;
  }

  greaterThan(other: AssetAmount): boolean {
    return this.compareTo(other) > 0;
  }

  static sum(asset: string, amounts: readonly AssetAmount[]): AssetAmount {
    return amounts.reduce<AssetAmount>(
      (total, amount) => total.add(amount),
      AssetAmount.zero(asset),
    );
  }

  private assertSameAsset(other: AssetAmount, operation: string): void {
    if (this.asset !== other.asset) {
      throw new CurrencyMismatchError(this.asset, other.asset, operation);
    }
  }

  toJSON(): AssetAmountJson {
    return {
      asset: this.asset,
      minorUnits: this.minorUnits.toString(),
      decimal: this.toDecimal().toFixed(this.exponent),
      exponent: this.exponent,
    };
  }

  toString(): string {
    return `${this.toDecimal().toFixed(this.exponent)} ${this.asset}`;
  }
}
