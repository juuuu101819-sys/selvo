const DEFAULT_API_BASE_URL = 'http://127.0.0.1:47311';

/** Public OpenAPI schema URL for external nav links. */
export function resolveOpenapiHref(): string {
  const base = (
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    process.env.API_BASE_URL ??
    DEFAULT_API_BASE_URL
  ).replace(/\/$/, '');
  return `${base}/api/v1/openapi.json`;
}
