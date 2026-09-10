'use client';

import { useState, useTransition } from 'react';
import {
  confirmMfaEnrollment,
  regenerateRecoveryCodes,
  saveOrgAuthSettings,
  startMfaEnrollment,
} from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { MfaStatusDto } from '@/lib/api/types';

export function SecuritySettings({
  mfa,
  requireMfaForPrivilegedRoles,
  oidc,
  canManageOrg,
}: {
  readonly mfa: MfaStatusDto;
  readonly requireMfaForPrivilegedRoles: boolean;
  readonly oidc: {
    readonly configured: boolean;
    readonly enabled: boolean;
    readonly issuer: string | null;
    readonly clientId: string | null;
    readonly redirectUri: string | null;
    readonly hasClientSecret: boolean;
  };
  readonly canManageOrg: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [otpauth, setOtpauth] = useState<string | null>(null);
  const [confirmCode, setConfirmCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<readonly string[] | null>(null);
  const [orgMfa, setOrgMfa] = useState(requireMfaForPrivilegedRoles);
  const [issuer, setIssuer] = useState(oidc.issuer ?? '');
  const [clientId, setClientId] = useState(oidc.clientId ?? '');
  const [clientSecret, setClientSecret] = useState('');
  const [redirectUri, setRedirectUri] = useState(
    oidc.redirectUri ?? 'http://127.0.0.1:43117/login/sso/callback',
  );
  const [oidcEnabled, setOidcEnabled] = useState(oidc.enabled);

  return (
    <div className="space-y-8">
      <section className="border-border rounded-xl border p-4 sm:p-5">
        <h2 className="text-sm font-semibold">Authenticator app (TOTP)</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Optional. After enrollment, password login returns a challenge instead of a session until
          you confirm a code. Recovery codes are single-use.
        </p>
        <p className="mt-3 text-sm">
          Status:{' '}
          {mfa.enrolled
            ? `enrolled · ${mfa.remainingRecoveryCodes} unused recovery codes`
            : 'not enrolled'}
        </p>
        {secret !== null && otpauth !== null ? (
          <div className="mt-4 space-y-3">
            <p className="text-sm">
              Add this secret to your authenticator, then confirm the current six-digit code. The
              secret is shown once.
            </p>
            <p className="font-mono text-xs break-all">{secret}</p>
            <p className="font-mono text-xs break-all">{otpauth}</p>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-totp">Confirmation code</Label>
              <Input
                id="confirm-totp"
                value={confirmCode}
                onChange={(event) => setConfirmCode(event.target.value)}
                autoComplete="one-time-code"
              />
            </div>
            <Button
              type="button"
              disabled={pending}
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  const result = await confirmMfaEnrollment(confirmCode);
                  if (!result.ok) {
                    setError(result.failure.message);
                    return;
                  }
                  setRecoveryCodes(result.data.recoveryCodes);
                  setSecret(null);
                  setOtpauth(null);
                  setConfirmCode('');
                });
              }}
            >
              Confirm enrollment
            </Button>
          </div>
        ) : (
          <Button
            className="mt-4"
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result = await startMfaEnrollment();
                if (!result.ok) {
                  setError(result.failure.message);
                  return;
                }
                setSecret(result.data.secret);
                setOtpauth(result.data.otpauthUrl);
                setRecoveryCodes(null);
              });
            }}
          >
            {mfa.enrolled ? 'Replace authenticator' : 'Enroll authenticator'}
          </Button>
        )}
        {mfa.enrolled ? (
          <div className="mt-4 space-y-2">
            <Label htmlFor="regen-totp">Regenerate recovery codes (current TOTP)</Label>
            <div className="flex flex-wrap gap-2">
              <Input
                id="regen-totp"
                className="max-w-xs"
                value={confirmCode}
                onChange={(event) => setConfirmCode(event.target.value)}
                autoComplete="one-time-code"
              />
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  setError(null);
                  startTransition(async () => {
                    const result = await regenerateRecoveryCodes(confirmCode);
                    if (!result.ok) {
                      setError(result.failure.message);
                      return;
                    }
                    setRecoveryCodes(result.data.recoveryCodes);
                    setConfirmCode('');
                  });
                }}
              >
                Regenerate
              </Button>
            </div>
          </div>
        ) : null}
        {recoveryCodes !== null ? (
          <div className="mt-4">
            <p className="text-sm font-medium">Store these recovery codes now. They are shown once.</p>
            <ul className="mt-2 font-mono text-xs">
              {recoveryCodes.map((code) => (
                <li key={code}>{code}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {canManageOrg ? (
        <section className="border-border rounded-xl border p-4 sm:p-5">
          <h2 className="text-sm font-semibold">Organization enforcement</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Off by default. When enabled, owner and admin accounts must enroll TOTP before a
            session is issued. Members and viewers are unchanged.
          </p>
          <label className="mt-4 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={orgMfa}
              onChange={(event) => setOrgMfa(event.target.checked)}
            />
            Require MFA for owner and admin
          </label>
          <Button
            className="mt-4"
            type="button"
            disabled={pending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result = await saveOrgAuthSettings({
                  requireMfaForPrivilegedRoles: orgMfa,
                });
                if (!result.ok) {
                  setError(result.failure.message);
                }
              });
            }}
          >
            Save MFA policy
          </Button>

          <h3 className="mt-8 text-sm font-semibold">OpenID Connect</h3>
          <p className="text-muted-foreground mt-1 text-sm">
            Generic IdP configuration. The client secret is write-only and stored encrypted. SSO
            maps an existing member by email and issues the same session scopes as password login.
            It does not create users.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="oidc-issuer">Issuer</Label>
              <Input
                id="oidc-issuer"
                value={issuer}
                onChange={(event) => setIssuer(event.target.value)}
                placeholder="https://idp.example.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="oidc-client-id">Client ID</Label>
              <Input
                id="oidc-client-id"
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="oidc-secret">
                Client secret {oidc.hasClientSecret ? '(stored; leave blank to keep)' : ''}
              </Label>
              <Input
                id="oidc-secret"
                type="password"
                value={clientSecret}
                onChange={(event) => setClientSecret(event.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="oidc-redirect">Redirect URI</Label>
              <Input
                id="oidc-redirect"
                value={redirectUri}
                onChange={(event) => setRedirectUri(event.target.value)}
              />
            </div>
          </div>
          <label className="mt-4 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={oidcEnabled}
              onChange={(event) => setOidcEnabled(event.target.checked)}
            />
            Enable SSO for this organization
          </label>
          <Button
            className="mt-4"
            type="button"
            disabled={pending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result = await saveOrgAuthSettings({
                  oidc: {
                    issuer,
                    clientId,
                    redirectUri,
                    enabled: oidcEnabled,
                    ...(clientSecret.trim() === '' ? {} : { clientSecret: clientSecret.trim() }),
                  },
                });
                if (!result.ok) {
                  setError(result.failure.message);
                  return;
                }
                setClientSecret('');
              });
            }}
          >
            Save SSO
          </Button>
        </section>
      ) : null}

      {error !== null && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
