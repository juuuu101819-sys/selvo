import { DashboardEmpty, SessionEnded } from '@/components/dashboard/states';
import { ApiKeyManager } from '@/components/dashboard/api-key-manager';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ErrorState } from '@/components/states';
import { fetchDashboardSettings } from '@/lib/api/client';
import { loadDashboardSession } from '@/lib/dashboard-auth';

export default async function DashboardSettingsPage() {
  const session = await loadDashboardSession();
  if (!session.ok) {
    return <SessionEnded failure={session.failure} />;
  }

  const result = await fetchDashboardSettings(session.token);
  if (!result.ok) {
    return <ErrorState failure={result.failure} />;
  }

  const { organization, members, apiKeys, role } = result.data;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Organization settings</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Membership and API key prefixes for {organization?.name ?? session.me.organization.name}.
          Secrets are never returned.
        </p>
      </div>

      <section className="border-border rounded-xl border p-4 sm:p-5">
        <h2 className="text-sm font-semibold">Tenant</h2>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Name</dt>
            <dd>{organization?.name ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Slug</dt>
            <dd className="font-mono text-xs">{organization?.slug ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Country</dt>
            <dd className="font-mono text-xs">{organization?.countryCode ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Your role</dt>
            <dd>
              <Badge variant="secondary">{role ?? session.me.role ?? 'member'}</Badge>
            </dd>
          </div>
        </dl>
      </section>

      <section>
        <h2 className="text-sm font-semibold">Members</h2>
        {members.length === 0 ? (
          <DashboardEmpty title="No members">
            This organization has no active members.
          </DashboardEmpty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => (
                <TableRow key={member.userId}>
                  <TableCell>{member.displayName}</TableCell>
                  <TableCell className="font-mono text-xs">{member.email}</TableCell>
                  <TableCell>{member.role}</TableCell>
                  <TableCell>{member.status}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <ApiKeyManager
        keys={apiKeys}
        canManage={role === 'owner' || role === 'admin' || session.me.role === 'owner'}
      />
    </div>
  );
}
