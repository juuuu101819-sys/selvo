/**
 * ISO 4217 exponents for currencies the dashboard can display.
 *
 * Duplicated from the API's registry rather than imported from `@meridian/core`: the web app talks
 * HTTP and should not compile against the engine. Unknown codes default to two decimal places, which
 * is the ISO 4217 majority case.
 */
export function exponentFor(currency: string): number {
  switch (currency) {
    case 'KRW':
    case 'JPY':
      return 0;
    case 'USDC':
    case 'USDT':
      return 6;
    case 'KWD':
    case 'BHD':
    case 'OMR':
      return 3;
    default:
      return 2;
  }
}
