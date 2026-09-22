const BOUNDARY_POINTS = [
  {
    id: 'non-custodial',
    title: 'Non-custodial',
    body: 'Meridian never holds customer funds, private keys or wallets. It returns decisions — not custody.',
  },
  {
    id: 'execution-gated',
    title: 'Execution gated (501)',
    body: 'POST /api/v1/executions remains 501 by design. Meridian does not move money on your behalf.',
  },
  {
    id: 'partners-settle',
    title: 'Licensed partners settle',
    body: 'Settlement stays with your licensed or authorized provider. Transact directly with them.',
  },
  {
    id: 'sandbox-default',
    title: 'Sandbox by default',
    body: 'Indicative sandbox quotes until licensed adapters are connected. Non-binding until you act with a partner.',
  },
] as const;

/**
 * Regulatory boundary explainer — left accent border cards from the approved mockup.
 */
export function WhyNeverTouchMoney() {
  return (
    <section aria-labelledby="why-never-touch-heading" className="space-y-6">
      <div className="max-w-2xl space-y-2">
        <h2 id="why-never-touch-heading" className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Why we never touch your money
        </h2>
        <p className="text-muted-foreground text-sm leading-relaxed sm:text-base">
          These boundaries are architectural, not marketing. They are enforced in the API and visible
          in every quote envelope.
        </p>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2">
        {BOUNDARY_POINTS.map((point) => (
          <li
            key={point.id}
            className="border-accent/50 bg-card/40 border-l-[3px] py-3 pl-4 pr-3 sm:py-4 sm:pl-5"
          >
            <h3 className="text-sm font-semibold">{point.title}</h3>
            <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">{point.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
