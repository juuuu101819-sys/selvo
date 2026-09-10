'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { acceptOrganizationInvite } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useRouter } from '@/i18n/navigation';

export function InviteForm({ initialToken }: { readonly initialToken: string }) {
  const t = useTranslations('invite');
  const router = useRouter();
  const [token, setToken] = useState(initialToken);
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await acceptOrganizationInvite({
            token,
            password,
            ...(displayName.trim() === '' ? {} : { displayName: displayName.trim() }),
          });
          if (!result.ok) {
            setError(result.failure.message);
            return;
          }
          router.push('/login');
        });
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="invite-token">{t('token')}</Label>
        <Input
          id="invite-token"
          name="token"
          required
          autoComplete="off"
          spellCheck={false}
          value={token}
          onChange={(event) => setToken(event.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="invite-name">{t('displayName')}</Label>
        <Input
          id="invite-name"
          name="displayName"
          autoComplete="name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="invite-password">{t('password')}</Label>
        <Input
          id="invite-password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <p className="text-muted-foreground text-xs">{t('passwordHint')}</p>
      </div>
      {error !== null && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending || token.trim() === '' || password.length < 12}>
        {pending ? t('accepting') : t('accept')}
      </Button>
    </form>
  );
}
