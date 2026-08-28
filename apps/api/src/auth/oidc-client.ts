import { UnauthenticatedError } from '@meridian/core';

export interface OidcAuthorizationRequest {
  readonly issuer: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly nonce: string;
}

export interface OidcTokenExchangeRequest {
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly code: string;
  readonly nonce: string;
}

export interface OidcFederatedIdentity {
  readonly email: string;
  readonly subject: string;
}

/**
 * Authorization-code OIDC client. Production talks to a generic IdP via discovery.
 * Tests inject {@link FakeOidcClient} so no network is required.
 */
export interface OidcClient {
  authorizationUrl(request: OidcAuthorizationRequest): Promise<string>;
  exchangeCode(request: OidcTokenExchangeRequest): Promise<OidcFederatedIdentity>;
}

interface OidcDiscovery {
  readonly authorization_endpoint: string;
  readonly token_endpoint: string;
  readonly jwks_uri: string;
}

export class FetchOidcClient implements OidcClient {
  async authorizationUrl(request: OidcAuthorizationRequest): Promise<string> {
    const discovery = await this.discover(request.issuer);
    const url = new URL(discovery.authorization_endpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', request.clientId);
    url.searchParams.set('redirect_uri', request.redirectUri);
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', request.state);
    url.searchParams.set('nonce', request.nonce);
    return url.toString();
  }

  async exchangeCode(request: OidcTokenExchangeRequest): Promise<OidcFederatedIdentity> {
    const discovery = await this.discover(request.issuer);
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: request.code,
      redirect_uri: request.redirectUri,
      client_id: request.clientId,
      client_secret: request.clientSecret,
    });
    const response = await fetch(discovery.token_endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    if (!response.ok) {
      throw new UnauthenticatedError('Federated identity could not be verified.', {
        scheme: 'oidc',
        enforcing: true,
      });
    }
    const tokenPayload: unknown = await response.json().catch(() => null);
    const idToken =
      tokenPayload !== null &&
      typeof tokenPayload === 'object' &&
      'id_token' in tokenPayload &&
      typeof tokenPayload.id_token === 'string'
        ? tokenPayload.id_token
        : null;
    if (idToken === null) {
      throw new UnauthenticatedError('Federated identity could not be verified.', {
        scheme: 'oidc',
        enforcing: true,
      });
    }

    const { createRemoteJWKSet, jwtVerify } = await import('jose');
    const jwks = createRemoteJWKSet(new URL(discovery.jwks_uri));
    let payload: { readonly email?: unknown; readonly sub?: unknown; readonly nonce?: unknown };
    try {
      const verified = await jwtVerify(idToken, jwks, {
        issuer: request.issuer.replace(/\/$/u, ''),
        audience: request.clientId,
      });
      payload = verified.payload;
    } catch {
      throw new UnauthenticatedError('Federated identity could not be verified.', {
        scheme: 'oidc',
        enforcing: true,
      });
    }
    if (payload.nonce !== request.nonce) {
      throw new UnauthenticatedError('Federated identity could not be verified.', {
        scheme: 'oidc',
        enforcing: true,
      });
    }
    if (typeof payload.email !== 'string' || payload.email.trim() === '') {
      throw new UnauthenticatedError('Federated identity is not mapped to an organization member.', {
        scheme: 'oidc',
        enforcing: true,
      });
    }
    return {
      email: payload.email.trim().toLowerCase(),
      subject: typeof payload.sub === 'string' ? payload.sub : payload.email,
    };
  }

  private async discover(issuer: string): Promise<OidcDiscovery> {
    const wellKnown = `${issuer.replace(/\/$/u, '')}/.well-known/openid-configuration`;
    const response = await fetch(wellKnown, { headers: { accept: 'application/json' } });
    if (!response.ok) {
      throw new UnauthenticatedError('SSO is not available for this organization.', {
        scheme: 'oidc',
        enforcing: true,
      });
    }
    const json: unknown = await response.json().catch(() => null);
    if (
      json === null ||
      typeof json !== 'object' ||
      !('authorization_endpoint' in json) ||
      !('token_endpoint' in json) ||
      !('jwks_uri' in json) ||
      typeof json.authorization_endpoint !== 'string' ||
      typeof json.token_endpoint !== 'string' ||
      typeof json.jwks_uri !== 'string'
    ) {
      throw new UnauthenticatedError('SSO is not available for this organization.', {
        scheme: 'oidc',
        enforcing: true,
      });
    }
    return {
      authorization_endpoint: json.authorization_endpoint,
      token_endpoint: json.token_endpoint,
      jwks_uri: json.jwks_uri,
    };
  }
}

/** In-process IdP stand-in. Maps authorization codes to emails; never talks to a network. */
export class FakeOidcClient implements OidcClient {
  readonly codes = new Map<string, OidcFederatedIdentity>();
  lastAuthorization: OidcAuthorizationRequest | null = null;

  authorizationUrl(request: OidcAuthorizationRequest): Promise<string> {
    this.lastAuthorization = request;
    const url = new URL(`${request.issuer.replace(/\/$/u, '')}/authorize`);
    url.searchParams.set('client_id', request.clientId);
    url.searchParams.set('redirect_uri', request.redirectUri);
    url.searchParams.set('state', request.state);
    url.searchParams.set('nonce', request.nonce);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    return Promise.resolve(url.toString());
  }

  exchangeCode(request: OidcTokenExchangeRequest): Promise<OidcFederatedIdentity> {
    const identity = this.codes.get(request.code);
    if (identity === undefined) {
      return Promise.reject(
        new UnauthenticatedError('Federated identity could not be verified.', {
          scheme: 'oidc',
          enforcing: true,
        }),
      );
    }
    return Promise.resolve(identity);
  }
}
