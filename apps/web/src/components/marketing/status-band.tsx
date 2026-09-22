import { Badge } from '@/components/ui/badge';

const SYSTEMS = [
  { name: 'Compare API', status: 'Operational · sandbox' },
  { name: 'Dashboard', status: 'Operational · sandbox' },
  { name: 'Webhooks', status: 'Operational · sandbox' },
] as const;

/**
 * Sandbox status band — no fake uptime percentages or production claims.
 */
export function StatusBand() {
  return (
    <section
      aria-labelledby="status-band-heading"
      className="marketing-surface rounded-2xl px-4 py-5 sm:px-6 sm:py-6"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="bg-recommend size-2 shrink-0 rounded-full" aria-hidden />
            <h2 id="status-band-heading" className="text-sm font-semibold">
              All sandbox systems operational
            </h2>
            <Badge variant="secondary" className="font-mono text-[10px] uppercase">
              Sandbox
            </Badge>
          </div>
          <p className="text-muted-foreground text-xs">
            Production status page will be published at launch — no fake uptime metrics here.
          </p>
        </div>
        <ul className="flex flex-col gap-2 sm:items-end">
          {SYSTEMS.map((system) => (
            <li
              key={system.name}
              className="flex items-center gap-2 font-mono text-[11px] tabular-nums"
            >
              <span className="text-foreground font-medium">{system.name}</span>
              <span className="text-muted-foreground">{system.status}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
