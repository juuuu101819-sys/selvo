/**
 * Who participates in a routed payment.
 *
 * Today's product is businesses (and humans acting for them) comparing routes. AI agents are a
 * declared participant so the API contract can grow without renaming the tenant model: an agent
 * will still act *for* an organization, never as a holder of funds.
 */

export const ECONOMIC_ACTOR_KINDS = ['human', 'business', 'ai_agent'] as const;
export type EconomicActorKind = (typeof ECONOMIC_ACTOR_KINDS)[number];

export const INTERACTION_MODEL_IDS = [
  'human_business',
  'business_business',
  'business_agent',
  'agent_business',
  'agent_agent',
] as const;
export type InteractionModelId = (typeof INTERACTION_MODEL_IDS)[number];

export interface InteractionModel {
  readonly id: InteractionModelId;
  readonly payer: EconomicActorKind;
  readonly payee: EconomicActorKind;
  readonly label: string;
  readonly status: 'available' | 'planned';
}

export const INTERACTION_MODELS: readonly InteractionModel[] = [
  {
    id: 'human_business',
    payer: 'human',
    payee: 'business',
    label: 'Human → Business',
    status: 'available',
  },
  {
    id: 'business_business',
    payer: 'business',
    payee: 'business',
    label: 'Business → Business',
    status: 'available',
  },
  {
    id: 'business_agent',
    payer: 'business',
    payee: 'ai_agent',
    label: 'Business → AI Agent',
    status: 'planned',
  },
  {
    id: 'agent_business',
    payer: 'ai_agent',
    payee: 'business',
    label: 'AI Agent → Business',
    status: 'available',
  },
  {
    id: 'agent_agent',
    payer: 'ai_agent',
    payee: 'ai_agent',
    label: 'AI Agent → AI Agent',
    status: 'planned',
  },
];

export function isEconomicActorKind(value: unknown): value is EconomicActorKind {
  return typeof value === 'string' && (ECONOMIC_ACTOR_KINDS as readonly string[]).includes(value);
}
