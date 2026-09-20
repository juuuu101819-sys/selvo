/** Footer cross-link columns — mirrors mega-menu destinations (subset for scannability). */
export type FooterColumnId = 'platform' | 'solutions' | 'developers' | 'resources' | 'company';

export type FooterLink = {
  readonly id: string;
  readonly href: string;
  readonly labelKey: string;
};

export type FooterColumn = {
  readonly id: FooterColumnId;
  readonly headingKey: string;
  readonly links: readonly FooterLink[];
};

export const FOOTER_COLUMNS: readonly FooterColumn[] = [
  {
    id: 'platform',
    headingKey: 'platform.label',
    links: [
      { id: 'compare', href: '/', labelKey: 'platform.items.compare.label' },
      { id: 'multirail', href: '/rails', labelKey: 'platform.items.multirail.label' },
      { id: 'graph', href: '/graph', labelKey: 'platform.items.graph.label' },
      { id: 'how', href: '/how-it-works', labelKey: 'platform.ctaButton' },
    ],
  },
  {
    id: 'solutions',
    headingKey: 'solutions.label',
    links: [
      { id: 'crossborder', href: '/solutions/cross-border', labelKey: 'solutions.items.crossborder.label' },
      { id: 'fintechs', href: '/solutions/fintechs', labelKey: 'solutions.items.fintechs.label' },
      { id: 'agentpay', href: '/agents', labelKey: 'solutions.items.agentpay.label' },
    ],
  },
  {
    id: 'developers',
    headingKey: 'developers.label',
    links: [
      { id: 'explorer', href: '/developers', labelKey: 'developers.items.explorer.label' },
      { id: 'reference', href: '/developers/reference', labelKey: 'developers.items.reference.label' },
      { id: 'status', href: '/developers/status', labelKey: 'developers.items.status.label' },
    ],
  },
  {
    id: 'resources',
    headingKey: 'resources.label',
    links: [
      { id: 'playbook', href: '/resources/playbook', labelKey: 'resources.items.playbook.label' },
      { id: 'noncustodial', href: '/trust/non-custodial', labelKey: 'resources.items.noncustodial.label' },
      { id: 'legal', href: '/terms', labelKey: 'resources.items.legal.label' },
    ],
  },
  {
    id: 'company',
    headingKey: 'company.label',
    links: [
      { id: 'about', href: '/company/about', labelKey: 'company.items.about.label' },
      { id: 'pricing', href: '/pricing', labelKey: 'company.items.pricing.label' },
      { id: 'contact', href: '/company/contact', labelKey: 'solutions.ctaButton' },
    ],
  },
] as const;
