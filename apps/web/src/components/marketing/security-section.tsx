import { Badge } from '@/components/ui/badge';
import { SectionShell } from './section-shell';

const FACTS = [
  {
    id: 'non-custodial',
    title: 'Non-custodial by architecture',
    body: 'Meridian never holds customer funds, private keys or wallets. It returns signed decisions only.',
  },
  {
    id: 'execution-501',
    title: 'Execution gated (501)',
    body: 'POST /api/v1/executions remains 501 by design — no money movement on your behalf.',
  },
  {
    id: 'minimal-data',
    title: 'Minimal data retention',
    body: 'Comparison envelopes store what is needed to verify reproducibility — not custody of assets.',
  },
  {
    id: 'sandbox-isolation',
    title: 'Sandbox isolation',
    body: 'Sandbox mode is the default. Indicative quotes until licensed adapters are connected.',
  },
] as const;

const ROADMAP = [
  { id: 'soc2', label: 'SOC 2 Type II' },
  { id: 'pentest', label: 'Independent penetration test' },
  { id: 'residency', label: 'Data residency controls' },
  { id: 'sso', label: 'Enterprise SSO' },
] as const;

/**
 * Security by architecture — factual controls plus PLANNED roadmap items only.
 */
export function SecuritySection() {
  return (
    <SectionShell
      eyebrow="Security"
      heading="Security by architecture"
      subheading="Facts enforced today. Certifications on the roadmap are labelled PLANNED — not claimed."
    >
      <ul className="grid gap-3 sm:grid-cols-2">
        {FACTS.map((fact) => (
          <li
            key={fact.id}
            className="marketing-surface marketing-surface-feature rounded-xl p-4 sm:p-5"
          >
            <h3 className="text-sm font-semibold">{fact.title}</h3>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{fact.body}</p>
          </li>
        ))}
      </ul>

      <div className="marketing-surface rounded-xl p-4 sm:p-5">
        <p className="text-muted-foreground text-xs font-medium uppercase tracking-widest">
          Roadmap (not yet certified)
        </p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {ROADMAP.map((item) => (
            <li key={item.id}>
              <Badge variant="secondary" className="gap-1.5 text-[10px] uppercase">
                {item.label}
                <span className="text-muted-foreground font-normal normal-case">· PLANNED</span>
              </Badge>
            </li>
          ))}
        </ul>
      </div>
    </SectionShell>
  );
}
