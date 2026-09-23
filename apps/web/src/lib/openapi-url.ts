import { resolveApiBaseUrl } from '@/lib/api-base-url';

/** Public OpenAPI schema URL for external nav links. */
export function resolveOpenapiHref(): string {
  return `${resolveApiBaseUrl()}/api/v1/openapi.json`;
}
