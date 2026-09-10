'use client';

import { useState, useTransition } from 'react';
import { beginSsoSignIn, completeMfaSignIn, signIn } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { isMfaChallenge } from '@/lib/api/types';
import { DEMO_LOGIN } from '@/lib/demo-credentials';

export function LoginForm({
  nextPath,
  allowDemoCredentials = false,
}: {
  nextPath: string;
  allowDemoCredentials?: boolean;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [organizationSlug, setOrganizationSlug] = useState(
    allowDemoCredentials ? DEMO_LOGIN.organizationSlug : '',
  );
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (challengeToken !== null) {
    return (
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          startTransition(async () => {
            const result = await completeMfaSignIn(challengeToken, mfaCode, nextPath);
            if (!result.ok) {
              setError(result.failure.message);
            }
          });
        }}
      >
        <p className="text-sm">
          This account requires an authenticator code or a unused recovery code before a session is
          issued.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="mfa-code">Authenticator or recovery code</Label>
          <Input
            id="mfa-code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            value={mfaCode}
            onChange={(event) => setMfaCode(event.target.value)}
          />
        </div>
        {error !== null && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? 'Verifying…' : 'Verify and sign in'}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => {
              setChallengeToken(null);
              setMfaCode('');
              setError(null);
            }}
          >
            Back
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="space-y-8">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          startTransition(async () => {
            const result = await signIn(email, password, nextPath);
            if (!result.ok) {
              setError(result.failure.message);
              return;
            }
            if (isMfaChallenge(result.data)) {
              setChallengeToken(result.data.challengeToken);
            }
          });
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="email">Work email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        {error !== null && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? 'Signing in…' : 'Sign in'}
          </Button>
          {allowDemoCredentials ? (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => {
                setEmail(DEMO_LOGIN.email);
                setPassword(DEMO_LOGIN.password);
                setOrganizationSlug(DEMO_LOGIN.organizationSlug);
              }}
            >
              Use demo credentials
            </Button>
          ) : null}
        </div>
      </form>

      <form
        className="border-border space-y-4 border-t pt-6"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          startTransition(async () => {
            const result = await beginSsoSignIn(organizationSlug);
            if (!result.ok) {
              setError(result.failure.message);
              return;
            }
            window.location.assign(result.data.authorizationUrl);
          });
        }}
      >
        <p className="text-sm font-medium">Organization SSO</p>
        <p className="text-muted-foreground text-sm">
          Off by default. When your organization has enabled OIDC, sign in with the organization
          slug. Unmapped identities are rejected.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="organization-slug">Organization slug</Label>
          <Input
            id="organization-slug"
            name="organizationSlug"
            autoComplete="organization"
            value={organizationSlug}
            onChange={(event) => setOrganizationSlug(event.target.value)}
          />
        </div>
        <Button type="submit" variant="outline" disabled={pending || organizationSlug.trim() === ''}>
          {pending ? 'Redirecting…' : 'Continue with SSO'}
        </Button>
      </form>
    </div>
  );
}
