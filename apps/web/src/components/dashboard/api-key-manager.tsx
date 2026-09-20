'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { createOrganizationKey, revokeOrganizationKey } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { PublicApiKeyDto } from '@/lib/api/types';
import { formatTimestamp } from '@/lib/format';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const SCOPES = ['quote:read', 'route:read', 'transaction:create'] as const;

export function ApiKeyManager({
  keys,
  canManage,
}: {
  keys: readonly PublicApiKeyDto[];
  canManage: boolean;
}) {
  const [label, setLabel] = useState('Treasury automation');
  const [scopes, setScopes] = useState<readonly string[]>(['quote:read', 'route:read']);
  const [issuedSecret, setIssuedSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await createOrganizationKey({ label, scopes });
    setPending(false);
    if (!result.ok) {
      setError(result.failure.message);
      return;
    }
    setIssuedSecret(result.data.secret);
    router.refresh();
  }

  async function onRevoke(id: string) {
    setPending(true);
    setError(null);
    const result = await revokeOrganizationKey(id);
    setPending(false);
    if (!result.ok) {
      setError(result.failure.message);
      return;
    }
    router.refresh();
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold">API keys</h2>
        <p className="text-muted-foreground mt-1 text-xs">
          Secrets are hashed at rest and shown once. Prefixes are safe to display. Scopes:
          quote:read, route:read, transaction:create (records an intent — never a payment).
        </p>
      </div>

      {issuedSecret !== null && (
        <div className="border-warning/40 bg-warning/10 rounded-lg border p-3 text-sm">
          <p className="font-medium">Copy this secret now. It will not be shown again.</p>
          <code className="mt-2 block break-all font-mono text-xs">{issuedSecret}</code>
        </div>
      )}

      {error !== null && <p className="text-destructive text-sm">{error}</p>}

      {canManage && (
        <form onSubmit={onCreate} className="border-border space-y-3 rounded-xl border p-4">
          <div className="space-y-1">
            <Label htmlFor="api-key-label">Label</Label>
            <Input
              id="api-key-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              maxLength={80}
              required
            />
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Scopes</legend>
            {SCOPES.map((scope) => (
              <Label key={scope} className="font-normal">
                <input
                  type="checkbox"
                  checked={scopes.includes(scope)}
                  onChange={(event) => {
                    setScopes(
                      event.target.checked
                        ? [...scopes, scope]
                        : scopes.filter((item) => item !== scope),
                    );
                  }}
                />
                {scope}
              </Label>
            ))}
          </fieldset>
          <Button type="submit" size="sm" disabled={pending || scopes.length === 0}>
            Issue key
          </Button>
        </form>
      )}

      {keys.length === 0 ? (
        <p className="text-muted-foreground text-sm">No API keys have been issued.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Label</TableHead>
              <TableHead>Prefix</TableHead>
              <TableHead>Scopes</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead>Status</TableHead>
              {canManage ? <TableHead /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {keys.map((key) => (
              <TableRow key={key.id}>
                <TableCell>{key.label}</TableCell>
                <TableCell className="font-mono text-xs">{key.keyPrefix}…</TableCell>
                <TableCell className="font-mono text-xs">
                  {(key.scopes ?? []).join(', ') || '—'}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {key.expiresAt === null || key.expiresAt === undefined
                    ? '—'
                    : formatTimestamp(key.expiresAt)}
                </TableCell>
                <TableCell>{key.revokedAt === null ? 'active' : 'revoked'}</TableCell>
                {canManage ? (
                  <TableCell>
                    {key.revokedAt === null ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        disabled={pending}
                        onClick={() => {
                          void onRevoke(key.id);
                        }}
                      >
                        Revoke
                      </Button>
                    ) : null}
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
