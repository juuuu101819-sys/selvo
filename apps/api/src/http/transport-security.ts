/**
 * TLS terminates at the reverse proxy. The Node process listens on HTTP and never consults
 * X-Forwarded-Proto (spoofable). Production-locked processes still advertise HSTS so that, once a
 * browser has reached the origin over HTTPS, it will refuse later plaintext.
 *
 * Browsers ignore HSTS delivered over HTTP, so local staging compose on 127.0.0.1 remains usable.
 */
export const HSTS_HEADER_VALUE = 'max-age=31536000; includeSubDomains';

export function shouldAttachHsts(productionLocked: boolean): boolean {
  return productionLocked;
}
