/**
 * Titles for comparison failures, derived from the API error rather than restated from it.
 *
 * The body already names the amount, the corridor and any rail filter. The title's job is to
 * point at the right class of problem so the customer does not go looking for a missing currency
 * pair when the real issue is a wholesale minimum — or the other way around.
 */

export type ComparisonErrorTitleKey =
  | 'apiUnreachable'
  | 'apiTimeout'
  | 'checkRequest'
  | 'currencyNotSupported'
  | 'noQuoteOnRails'
  | 'noProviderWillPrice'
  | 'noRoutesAvailable'
  | 'signInRequired'
  | 'comparisonFailed';

/** Canonical English titles, matching `errors.*` in `messages/en.json`. */
const EN_TITLES: Record<ComparisonErrorTitleKey, string> = {
  apiUnreachable: 'Routing API unavailable',
  apiTimeout: 'The routing API timed out',
  checkRequest: 'Check the request',
  currencyNotSupported: 'Currency not supported',
  noQuoteOnRails: 'No quote on the selected rails',
  noProviderWillPrice: 'No provider will price this',
  noRoutesAvailable: 'No provider could quote',
  signInRequired: 'Sign in required',
  comparisonFailed: 'Comparison failed',
};

export function comparisonErrorTitleKey(failure: {
  readonly code: string;
  readonly details: Record<string, unknown>;
}): ComparisonErrorTitleKey {
  switch (failure.code) {
    case 'API_UNREACHABLE':
      return 'apiUnreachable';
    case 'API_TIMEOUT':
      return 'apiTimeout';
    case 'VALIDATION_ERROR':
      return 'checkRequest';
    case 'UNSUPPORTED_CURRENCY':
      return 'currencyNotSupported';
    case 'UNSUPPORTED_CORRIDOR': {
      const rails = failure.details['rails'];
      if (Array.isArray(rails) && rails.length > 0) {
        return 'noQuoteOnRails';
      }
      // The engine uses one code for "no one covers this pair" and "the notional is outside every
      // book". The message body distinguishes them; the title stays honest about both.
      return 'noProviderWillPrice';
    }
    case 'NO_ROUTES_AVAILABLE':
      return 'noRoutesAvailable';
    case 'UNAUTHENTICATED':
      return 'signInRequired';
    default:
      return 'comparisonFailed';
  }
}

export function comparisonErrorTitle(failure: {
  readonly code: string;
  readonly details: Record<string, unknown>;
}): string {
  return EN_TITLES[comparisonErrorTitleKey(failure)];
}
