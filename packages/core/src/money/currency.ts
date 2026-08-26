import { UnsupportedCurrencyError } from '../errors/index.js';

export interface CurrencyDefinition {
  /** ISO 4217 alphabetic code. */
  readonly code: string;
  /** ISO 4217 minor unit exponent. `2` for USD (cents), `0` for KRW, `3` for KWD. */
  readonly exponent: number;
  readonly name: string;
}

/**
 * ISO 4217 reference data for the currencies the platform supports.
 *
 * This is standards data, not pricing data — no rate, spread or fee appears here.
 * The exponent is what makes integer minor-unit arithmetic correct per currency.
 */
export const CURRENCY_REGISTRY = {
  AED: { code: 'AED', exponent: 2, name: 'UAE Dirham' },
  AUD: { code: 'AUD', exponent: 2, name: 'Australian Dollar' },
  BRL: { code: 'BRL', exponent: 2, name: 'Brazilian Real' },
  CAD: { code: 'CAD', exponent: 2, name: 'Canadian Dollar' },
  CHF: { code: 'CHF', exponent: 2, name: 'Swiss Franc' },
  CLP: { code: 'CLP', exponent: 0, name: 'Chilean Peso' },
  CNY: { code: 'CNY', exponent: 2, name: 'Chinese Yuan' },
  EUR: { code: 'EUR', exponent: 2, name: 'Euro' },
  GBP: { code: 'GBP', exponent: 2, name: 'Pound Sterling' },
  HKD: { code: 'HKD', exponent: 2, name: 'Hong Kong Dollar' },
  IDR: { code: 'IDR', exponent: 2, name: 'Indonesian Rupiah' },
  INR: { code: 'INR', exponent: 2, name: 'Indian Rupee' },
  JPY: { code: 'JPY', exponent: 0, name: 'Japanese Yen' },
  KES: { code: 'KES', exponent: 2, name: 'Kenyan Shilling' },
  KRW: { code: 'KRW', exponent: 0, name: 'South Korean Won' },
  KWD: { code: 'KWD', exponent: 3, name: 'Kuwaiti Dinar' },
  MXN: { code: 'MXN', exponent: 2, name: 'Mexican Peso' },
  NGN: { code: 'NGN', exponent: 2, name: 'Nigerian Naira' },
  PHP: { code: 'PHP', exponent: 2, name: 'Philippine Peso' },
  SGD: { code: 'SGD', exponent: 2, name: 'Singapore Dollar' },
  THB: { code: 'THB', exponent: 2, name: 'Thai Baht' },
  TRY: { code: 'TRY', exponent: 2, name: 'Turkish Lira' },
  USD: { code: 'USD', exponent: 2, name: 'US Dollar' },
  VND: { code: 'VND', exponent: 0, name: 'Vietnamese Dong' },
  ZAR: { code: 'ZAR', exponent: 2, name: 'South African Rand' },
} as const satisfies Record<string, CurrencyDefinition>;

export type CurrencyCode = keyof typeof CURRENCY_REGISTRY;

export const SUPPORTED_CURRENCIES: readonly CurrencyCode[] = (
  Object.keys(CURRENCY_REGISTRY) as CurrencyCode[]
).sort();

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CURRENCY_REGISTRY, value);
}

export function assertCurrencyCode(value: unknown): CurrencyCode {
  if (!isCurrencyCode(value)) {
    throw new UnsupportedCurrencyError(String(value), SUPPORTED_CURRENCIES);
  }
  return value;
}

export function currencyDefinition(code: CurrencyCode): CurrencyDefinition {
  return CURRENCY_REGISTRY[code];
}

export function currencyExponent(code: CurrencyCode): number {
  return CURRENCY_REGISTRY[code].exponent;
}
