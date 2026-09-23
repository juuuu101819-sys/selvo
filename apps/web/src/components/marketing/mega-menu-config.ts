export type NavItemTag = 'LIVE' | 'SOON';

export type MegaMenuLink = {
  readonly id: string;
  readonly href: string;
  readonly tag: NavItemTag;
  readonly external?: boolean;
};

export type MegaMenuColumn = {
  readonly headingKey: string;
  readonly items: readonly MegaMenuLink[];
};

export type MegaMenuPanelId = 'platform' | 'solutions' | 'developers' | 'resources' | 'company';

export type MegaMenuPanel = {
  readonly id: MegaMenuPanelId;
  readonly labelKey: string;
  readonly align?: 'start' | 'end';
  readonly visual?: {
    readonly titleKey: string;
    readonly bodyKey: string;
    readonly linkKey: string;
    readonly href: string;
  };
  readonly columns: readonly MegaMenuColumn[];
  readonly cta: {
    readonly textKey: string;
    readonly buttonKey: string;
    readonly href: string;
  };
};

/** Static href/tag map from docs/MERIDIAN_CONTENT_SPEC.md Part A. Labels live in `nav` catalogs. */
export function buildMegaMenuPanels(openapiHref: string): readonly MegaMenuPanel[] {
  return [
    {
      id: 'platform',
      labelKey: 'platform.label',
      align: 'start',
      visual: {
        titleKey: 'platform.visualTitle',
        bodyKey: 'platform.visualBody',
        linkKey: 'platform.visualLink',
        href: '/login',
      },
      columns: [
        {
          headingKey: 'platform.exploreHeading',
          items: [
            { id: 'compare', href: '/', tag: 'LIVE' },
            { id: 'multirail', href: '/rails', tag: 'LIVE' },
            { id: 'graph', href: '/graph', tag: 'LIVE' },
          ],
        },
        {
          headingKey: 'platform.railsHeading',
          items: [
            { id: 'stablecoins', href: '/stablecoins', tag: 'LIVE' },
            { id: 'defi', href: '/defi', tag: 'LIVE' },
            { id: 'agents', href: '/agents', tag: 'LIVE' },
          ],
        },
      ],
      cta: {
        textKey: 'platform.ctaText',
        buttonKey: 'platform.ctaButton',
        href: '/how-it-works',
      },
    },
    {
      id: 'solutions',
      labelKey: 'solutions.label',
      align: 'start',
      columns: [
        {
          headingKey: 'solutions.usecaseHeading',
          items: [
            { id: 'crossborder', href: '/solutions/cross-border', tag: 'LIVE' },
            { id: 'treasury', href: '/solutions/treasury', tag: 'LIVE' },
            { id: 'agentpay', href: '/agents', tag: 'LIVE' },
          ],
        },
        {
          headingKey: 'solutions.customerHeading',
          items: [
            { id: 'fintechs', href: '/solutions/fintechs', tag: 'LIVE' },
            { id: 'platforms', href: '/solutions/platforms', tag: 'LIVE' },
            { id: 'enterprises', href: '/solutions/enterprises', tag: 'LIVE' },
          ],
        },
      ],
      cta: {
        textKey: 'solutions.ctaText',
        buttonKey: 'solutions.ctaButton',
        href: '/company/contact',
      },
    },
    {
      id: 'developers',
      labelKey: 'developers.label',
      align: 'start',
      visual: {
        titleKey: 'developers.visualTitle',
        bodyKey: 'developers.visualBody',
        linkKey: 'developers.visualLink',
        href: '/developers',
      },
      columns: [
        {
          headingKey: 'developers.buildHeading',
          items: [
            { id: 'explorer', href: '/developers', tag: 'LIVE' },
            { id: 'openapi', href: openapiHref, tag: 'LIVE', external: true },
            { id: 'reference', href: '/developers/reference', tag: 'LIVE' },
          ],
        },
        {
          headingKey: 'developers.toolkitHeading',
          items: [
            { id: 'sdks', href: '/developers/sdks', tag: 'LIVE' },
            { id: 'changelog', href: '/developers/changelog', tag: 'SOON' },
            { id: 'status', href: '/developers/status', tag: 'LIVE' },
          ],
        },
      ],
      cta: {
        textKey: 'developers.ctaText',
        buttonKey: 'developers.ctaButton',
        href: '/login',
      },
    },
    {
      id: 'resources',
      labelKey: 'resources.label',
      align: 'end',
      columns: [
        {
          headingKey: 'resources.learnHeading',
          items: [
            { id: 'blog', href: '/resources/blog', tag: 'SOON' },
            { id: 'playbook', href: '/resources/playbook', tag: 'LIVE' },
            { id: 'webinars', href: '/resources/webinars', tag: 'SOON' },
          ],
        },
        {
          headingKey: 'resources.trustHeading',
          items: [
            { id: 'noncustodial', href: '/trust/non-custodial', tag: 'LIVE' },
            { id: 'security', href: '/trust/security', tag: 'LIVE' },
            { id: 'legal', href: '/terms', tag: 'LIVE' },
          ],
        },
      ],
      cta: {
        textKey: 'resources.ctaText',
        buttonKey: 'resources.ctaButton',
        href: '/trust/non-custodial',
      },
    },
    {
      id: 'company',
      labelKey: 'company.label',
      align: 'end',
      columns: [
        {
          headingKey: 'company.companyHeading',
          items: [
            { id: 'about', href: '/company/about', tag: 'LIVE' },
            { id: 'careers', href: '/company/careers', tag: 'LIVE' },
            { id: 'partners', href: '/company/partners', tag: 'LIVE' },
          ],
        },
        {
          headingKey: 'company.moreHeading',
          items: [
            { id: 'pricing', href: '/pricing', tag: 'LIVE' },
            { id: 'brand', href: '/company/brand', tag: 'LIVE' },
          ],
        },
      ],
      cta: {
        textKey: 'company.ctaText',
        buttonKey: 'company.ctaButton',
        href: '/pricing',
      },
    },
  ] as const;
}

/** Translation prefix: nav.{panelId}.items.{itemId} */
export function itemLabelKey(panelId: MegaMenuPanelId, itemId: string): string {
  return `${panelId}.items.${itemId}.label`;
}

export function itemDescKey(panelId: MegaMenuPanelId, itemId: string): string {
  return `${panelId}.items.${itemId}.desc`;
}
