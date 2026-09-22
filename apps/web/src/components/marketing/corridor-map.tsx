import { SectionShell } from './section-shell';

/** Hub positions on the stylized globe (viewBox 0 0 400 240). */
const HUBS = [
  { id: 'usd', label: 'USD', x: 95, y: 118, status: 'priced' as const },
  { id: 'eur', label: 'EUR', x: 195, y: 95, status: 'priced' as const },
  { id: 'gbp', label: 'GBP', x: 175, y: 78, status: 'coverage' as const },
  { id: 'krw', label: 'KRW', x: 285, y: 108, status: 'priced' as const },
  { id: 'sgd', label: 'SGD', x: 255, y: 145, status: 'coverage' as const },
  { id: 'aed', label: 'AED', x: 220, y: 132, status: 'planned' as const },
] as const;

const ARCS: { from: string; to: string; status: 'priced' | 'coverage' | 'planned' }[] = [
  { from: 'usd', to: 'eur', status: 'priced' },
  { from: 'usd', to: 'krw', status: 'priced' },
  { from: 'gbp', to: 'usd', status: 'coverage' },
  { from: 'eur', to: 'gbp', status: 'coverage' },
  { from: 'usd', to: 'sgd', status: 'coverage' },
  { from: 'sgd', to: 'aed', status: 'planned' },
];

const STATUS_STROKE = {
  priced: 'var(--recommend)',
  coverage: 'var(--primary)',
  planned: 'var(--muted-foreground)',
} as const;

const STATUS_FILL = {
  priced: 'color-mix(in oklch, var(--recommend) 25%, transparent)',
  coverage: 'color-mix(in oklch, var(--primary) 20%, transparent)',
  planned: 'color-mix(in oklch, var(--muted-foreground) 20%, transparent)',
} as const;

function hubById(id: string) {
  const hub = HUBS.find((h) => h.id === id);
  if (!hub) throw new Error(`Unknown hub: ${id}`);
  return hub;
}

function arcPath(from: (typeof HUBS)[number], to: (typeof HUBS)[number]): string {
  const mx = (from.x + to.x) / 2;
  const my = Math.min(from.y, to.y) - 36;
  return `M ${from.x} ${from.y} Q ${mx} ${my} ${to.x} ${to.y}`;
}

/**
 * Stylized corridor map — arcs show comparison coverage, not live settlement.
 */
export function CorridorMap() {
  return (
    <SectionShell
      eyebrow="Map"
      heading="Corridors priced across the graph"
      subheading="Arcs represent comparison corridors in sandbox — not real-time settlement paths."
    >
      <div className="marketing-surface rounded-2xl p-4 sm:p-6">
        <svg
          viewBox="0 0 400 240"
          className="mx-auto h-auto w-full max-w-2xl"
          role="img"
          aria-label="Stylized globe with currency hubs and comparison corridor arcs"
        >
          <defs>
            <radialGradient id="globe-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.18" />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
            </radialGradient>
          </defs>
          <ellipse cx="200" cy="120" rx="148" ry="88" fill="url(#globe-glow)" />
          <ellipse
            cx="200"
            cy="120"
            rx="148"
            ry="88"
            fill="none"
            stroke="var(--line)"
            strokeWidth="1"
          />
          {[60, 100, 140, 180].map((y) => (
            <ellipse
              key={y}
              cx="200"
              cy="120"
              rx={148 * Math.cos(((y - 120) / 88) * (Math.PI / 4))}
              ry={88}
              fill="none"
              stroke="var(--line)"
              strokeWidth="0.5"
              opacity="0.35"
            />
          ))}

          {ARCS.map((arc) => {
            const from = hubById(arc.from);
            const to = hubById(arc.to);
            return (
              <path
                key={`${arc.from}-${arc.to}`}
                d={arcPath(from, to)}
                fill="none"
                stroke={STATUS_STROKE[arc.status]}
                strokeWidth="2"
                strokeOpacity={arc.status === 'planned' ? 0.45 : 0.85}
                strokeDasharray={arc.status === 'planned' ? '4 4' : undefined}
              />
            );
          })}

          {HUBS.map((hub) => (
            <g key={hub.id}>
              <circle cx={hub.x} cy={hub.y} r="14" fill={STATUS_FILL[hub.status]} />
              <circle
                cx={hub.x}
                cy={hub.y}
                r="14"
                fill="none"
                stroke={STATUS_STROKE[hub.status]}
                strokeWidth="1.5"
              />
              <text
                x={hub.x}
                y={hub.y + 28}
                textAnchor="middle"
                className="fill-foreground font-mono text-[10px]"
              >
                {hub.label}
              </text>
            </g>
          ))}
        </svg>

        <div className="mt-4 flex flex-wrap gap-4 text-xs">
          <span className="inline-flex items-center gap-2">
            <span className="bg-recommend size-2.5 rounded-full" aria-hidden />
            Priced in sandbox
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="bg-primary size-2.5 rounded-full" aria-hidden />
            Coverage expanding
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="bg-muted-foreground size-2.5 rounded-full" aria-hidden />
            Planned
          </span>
        </div>

        <p className="text-muted-foreground mt-4 text-xs leading-relaxed">
          Arcs show corridors Meridian can compare — not live settlement. Meridian never holds funds
          or keys; licensed partners settle.
        </p>
      </div>
    </SectionShell>
  );
}
