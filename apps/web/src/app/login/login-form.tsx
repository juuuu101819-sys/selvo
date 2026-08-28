'use client';

import { useState, useTransition } from 'react';
import { signIn } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await signIn(email, password, nextPath);
          if (!result.ok) {
            setError(result.failure.message);
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
            }}
          >
            Use demo credentials
          </Button>
        ) : null}
      </div>
    </form>
  );
}
