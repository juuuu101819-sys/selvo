import type { OidcConnectionRecord, PublicOidcConnection } from '@meridian/core';

export function publicOidcConnection(
  record: OidcConnectionRecord | null,
): PublicOidcConnection {
  if (record === null) {
    return {
      configured: false,
      enabled: false,
      issuer: null,
      clientId: null,
      redirectUri: null,
      hasClientSecret: false,
    };
  }
  return {
    configured: true,
    enabled: record.enabled,
    issuer: record.issuer,
    clientId: record.clientId,
    redirectUri: record.redirectUri,
    hasClientSecret: record.clientSecretCiphertext !== null && record.clientSecretCiphertext !== '',
  };
}
