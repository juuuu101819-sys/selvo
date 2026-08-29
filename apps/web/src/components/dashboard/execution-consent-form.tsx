'use client';

import { useState, useTransition } from 'react';
import { saveAgentExecutionAuthorization, saveOrgExecutionAuthorization } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Explicit consent for future delegated execution. Does not enable POST /executions (still 501).
 */
export function ExecutionConsentForm({
  kind,
  agentId,
  authorized,
  agreementReference,
  canManage,
}: {
  readonly kind: 'organization' | 'agent';
  readonly agentId?: string;
  readonly authorized: boolean;
  readonly agreementReference: string | null;
  readonly canManage: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState(agreementReference ?? 'ToS-unfinalized');

  return (
    <section className="border-border rounded-xl border p-4 sm:p-5">
      <h2 className="text-sm font-semibold">Future execution consent</h2>
      <p className="text-muted-foreground mt-1 text-sm">
        This flag records owner/admin consent for delegated execution <em>when that capability
        exists</em>. It has no effect today. <code className="font-mono text-xs">POST /api/v1/executions</code>{' '}
        remains 501. KYB verification is a different question.
      </p>
      <p className="mt-3 text-sm">
        Status:{' '}
        <span className="font-medium">{authorized ? 'consent recorded' : 'not authorized'}</span>
        {agreementReference !== null ? ` · ${agreementReference}` : ''}
      </p>
      {canManage ? (
        <div className="mt-4 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`agreement-${kind}`}>Agreement reference</Label>
            <Input
              id={`agreement-${kind}`}
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder="ToS version or contract id"
            />
          </div>
          {error !== null ? <p className="text-destructive text-sm">{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={pending}
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  const result =
                    kind === 'organization'
                      ? await saveOrgExecutionAuthorization({
                          authorized: true,
                          agreementReference: reference.trim(),
                        })
                      : await saveAgentExecutionAuthorization({
                          agentId: agentId ?? '',
                          authorized: true,
                          agreementReference: reference.trim(),
                        });
                  if (!result.ok) {
                    setError(result.failure.message);
                  }
                });
              }}
            >
              Record consent
            </Button>
            {authorized ? (
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  setError(null);
                  startTransition(async () => {
                    const result =
                      kind === 'organization'
                        ? await saveOrgExecutionAuthorization({ authorized: false })
                        : await saveAgentExecutionAuthorization({
                            agentId: agentId ?? '',
                            authorized: false,
                          });
                    if (!result.ok) {
                      setError(result.failure.message);
                    }
                  });
                }}
              >
                Withdraw consent
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground mt-3 text-sm">Only an owner or admin can change this.</p>
      )}
    </section>
  );
}
