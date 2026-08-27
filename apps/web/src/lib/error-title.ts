/**
 * Titles for comparison failures, derived from the API error rather than restated from it.
 *
 * The body already names the amount, the corridor and any rail filter. The title's job is to
 * point at the right class of problem so the customer does not go looking for a missing currency
 * pair when the real issue is a wholesale minimum — or the other way around.
 */

export function comparisonErrorTitle(failure: {
  readonly code: string;
  readonly details: Record<string, unknown>;
}): string {
  if (failure.code === 'API_UNREACHABLE' || failure.code === 'API_TIMEOUT') {
    return 'Routing API unavailable';
  }

  switch (failure.code) {
    case 'VALIDATION_ERROR':
      return 'Check the request';
    case 'UNSUPPORTED_CURRENCY':
      return 'Currency not supported';
    case 'UNSUPPORTED_CORRIDOR': {
      const rails = failure.details['rails'];
      if (Array.isArray(rails) && rails.length > 0) {
        return 'No quote on the selected rails';
      }
      // The engine uses one code for "no one covers this pair" and "the notional is outside every
      // book". The message body distinguishes them; the title stays honest about both.
      return 'No provider will price this';
    }
    case 'NO_ROUTES_AVAILABLE':
      return 'No provider could quote';
    default:
      return 'Comparison failed';
  }
}
