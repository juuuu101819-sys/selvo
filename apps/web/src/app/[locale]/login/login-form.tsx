'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
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
  const t = useTranslations('login');
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
        <p className="text-sm">{t('mfaBody')}</p>
        <div className="space-y-1.5">
          <Label htmlFor="mfa-code">{t('mfaCode')}</Label>
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
            {pending ? t('verifying') : t('verify')}
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
            {t('back')}
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
          <Label htmlFor="email">{t('email')}</Label>
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
          <Label htmlFor="password">{t('password')}</Label>
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
            {pending ? t('signingIn') : t('signIn')}
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
              {t('useDemo')}
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
        <p className="text-sm font-medium">{t('ssoTitle')}</p>
        <p className="text-muted-foreground text-sm">{t('ssoBody')}</p>
        <div className="space-y-1.5">
          <Label htmlFor="organization-slug">{t('orgSlug')}</Label>
          <Input
            id="organization-slug"
            name="organizationSlug"
            autoComplete="organization"
            value={organizationSlug}
            onChange={(event) => setOrganizationSlug(event.target.value)}
          />
        </div>
        <Button type="submit" variant="outline" disabled={pending || organizationSlug.trim() === ''}>
          {pending ? t('redirecting') : t('continueSso')}
        </Button>
      </form>
    </div>
  );
}
