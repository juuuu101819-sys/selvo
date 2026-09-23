/** Production Railway API — used when API_BASE_URL / NEXT_PUBLIC_API_BASE_URL are unset. */
export const DEFAULT_API_BASE_URL = 'https://selvo-production.up.railway.app';

/** API origin without trailing slash (OpenAPI links, code samples, server-side fetches). */
export function resolveApiBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    process.env.API_BASE_URL ??
    DEFAULT_API_BASE_URL
  ).replace(/\/$/, '');
}
