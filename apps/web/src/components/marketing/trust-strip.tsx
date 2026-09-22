const TRUST_PILLS = [
  'Non-custodial',
  'Sandbox',
  'Executions gated (501)',
  'Licensed partners settle',
  'Priced vs mid-market',
] as const;

/**
 * Regulatory posture strip below the hero. Copy matches the approved landing mockup.
 * i18n keys for batch 2 — presentation-only strings for batch 1/3.
 */
function pillClass(label: (typeof TRUST_PILLS)[number]): string {
  return label === 'Sandbox' || label === 'Executions gated (501)'
    ? 'border-accent/35 bg-accent/10 text-accent-foreground rounded-full border px-3 py-1 text-[11px] font-medium tracking-wide whitespace-nowrap sm:text-xs'
    : 'border-border/60 bg-secondary/40 text-foreground/90 rounded-full border px-3 py-1 text-[11px] font-medium tracking-wide whitespace-nowrap sm:text-xs';
}

export function TrustStrip() {
  return (
    <div
      className="flex flex-wrap items-center justify-center gap-x-2 gap-y-2 md:flex-nowrap md:gap-x-3"
      aria-label="Meridian regulatory posture"
    >
      {TRUST_PILLS.map((label, index) => (
        <span key={label} className="inline-flex shrink-0 items-center gap-x-2 md:gap-x-3">
          {index > 0 ? (
            <span aria-hidden className="text-muted-foreground/50 text-xs">
              ·
            </span>
          ) : null}
          <span className={pillClass(label)}>{label}</span>
        </span>
      ))}
    </div>
  );
}
