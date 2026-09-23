import type { ComparisonDto, RouteDto } from '@/lib/api/types';

/** Scoring factors present on comparison wire (excludes legacy reliability and absent fxRate). */
export const EXPLANATION_FACTORS = [
  'cost',
  'speed',
  'settlementConfidence',
  'slippage',
  'liquidity',
  'risk',
] as const;

export type ExplanationFactor = (typeof EXPLANATION_FACTORS)[number];

export type DimensionLeader = 'cheapest' | 'fastest';

export interface RouteExplanationFacts {
  readonly rank: number;
  readonly topFactors: readonly ExplanationFactor[];
  readonly dimensionLeaders: readonly DimensionLeader[];
  readonly totalCostPercent: string;
  readonly settlementP50Seconds: number;
  readonly settlementBusinessDaysOnly: boolean;
  readonly reliabilityScore: string;
}

export interface ExplainRouteInput {
  readonly route: RouteDto;
  readonly scoringWeights: ComparisonDto['scoringWeights'];
  readonly insights: ComparisonDto['insights'];
}

export interface RouteExplanationFormattedValues {
  readonly cost: string;
  readonly settlement: string;
  readonly reliability: string;
}

export interface RouteExplanationMessages {
  readonly rankLead: string;
  readonly cheapestLeader: string;
  readonly fastestLeader: string;
  readonly and: string;
  readonly droveResult: string;
  readonly factorLabel: (factor: ExplanationFactor) => string;
  readonly carriesMostWeight: (factor: string) => string;
  readonly carriesWeightWith: (first: string, second: string) => string;
  readonly footer: (settlement: string, reliability: string) => string;
}

function componentValue(
  components: RouteDto['scoreComponents'],
  factor: ExplanationFactor,
): number {
  const raw =
    factor === 'cost'
      ? components.cost
      : factor === 'speed'
        ? components.speed
        : factor === 'settlementConfidence'
          ? components.settlementConfidence
          : factor === 'slippage'
            ? components.slippage
            : factor === 'liquidity'
              ? components.liquidity
              : components.risk;
  if (raw === undefined || raw === '') {
    return 0;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

function weightValue(weights: ComparisonDto['scoringWeights'], factor: ExplanationFactor): number {
  const raw =
    factor === 'cost'
      ? weights.cost
      : factor === 'speed'
        ? weights.speed
        : factor === 'settlementConfidence'
          ? weights.settlementConfidence
          : factor === 'slippage'
            ? weights.slippage
            : factor === 'liquidity'
              ? weights.liquidity
              : weights.risk;
  if (raw === undefined || raw === '') {
    return 0;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

/** Weighted contribution per factor: component (0–1) × request weight. */
export function factorContributions(
  components: RouteDto['scoreComponents'],
  weights: ComparisonDto['scoringWeights'],
): readonly { readonly factor: ExplanationFactor; readonly contribution: number }[] {
  return EXPLANATION_FACTORS.map((factor) => ({
    factor,
    contribution: componentValue(components, factor) * weightValue(weights, factor),
  }))
    .filter((entry) => entry.contribution > 0)
    .sort((left, right) => {
      const byContribution = right.contribution - left.contribution;
      if (byContribution !== 0) {
        return byContribution;
      }
      return EXPLANATION_FACTORS.indexOf(left.factor) - EXPLANATION_FACTORS.indexOf(right.factor);
    });
}

/** Top 1–2 factors by weighted contribution (deterministic tie-break on factor order). */
export function topContributingFactors(
  components: RouteDto['scoreComponents'],
  weights: ComparisonDto['scoringWeights'],
): readonly ExplanationFactor[] {
  const ranked = factorContributions(components, weights);
  if (ranked.length === 0) {
    return ['cost'];
  }
  const topContribution = ranked[0]!.contribution;
  const tiedAtTop = ranked.filter((entry) => entry.contribution === topContribution);
  if (tiedAtTop.length >= 2) {
    return tiedAtTop.slice(0, 2).map((entry) => entry.factor);
  }
  const leaders: ExplanationFactor[] = [ranked[0]!.factor];
  if (ranked[1] !== undefined) {
    leaders.push(ranked[1].factor);
  }
  return leaders;
}

export function dimensionLeadersForRoute(
  routeId: string,
  insights: ComparisonDto['insights'],
): readonly DimensionLeader[] {
  if (insights === null) {
    return [];
  }
  const leaders: DimensionLeader[] = [];
  if (insights.cheapestRouteId === routeId) {
    leaders.push('cheapest');
  }
  if (insights.fastestRouteId === routeId) {
    leaders.push('fastest');
  }
  return leaders;
}

export function explainRouteFacts(input: ExplainRouteInput): RouteExplanationFacts {
  const { route, scoringWeights, insights } = input;
  return {
    rank: route.rank,
    topFactors: topContributingFactors(route.scoreComponents, scoringWeights),
    dimensionLeaders: dimensionLeadersForRoute(route.routeId, insights),
    totalCostPercent: route.totalCostPercent,
    settlementP50Seconds: route.settlement.p50Seconds,
    settlementBusinessDaysOnly: route.settlement.businessDaysOnly,
    reliabilityScore: route.reliabilityScore,
  };
}

/** Assembles the explanation sentence from pre-formatted values and translated fragments. */
export function formatRouteExplanation(
  facts: RouteExplanationFacts,
  values: RouteExplanationFormattedValues,
  messages: RouteExplanationMessages,
): string {
  const leaderParts: string[] = [];
  if (facts.dimensionLeaders.includes('cheapest')) {
    leaderParts.push(messages.cheapestLeader);
  }
  if (facts.dimensionLeaders.includes('fastest')) {
    leaderParts.push(messages.fastestLeader);
  }

  const factorLabels = facts.topFactors.map((factor) => messages.factorLabel(factor));
  const factorSentence =
    factorLabels.length === 1
      ? messages.carriesMostWeight(factorLabels[0]!)
      : messages.carriesWeightWith(factorLabels[0]!, factorLabels[1] ?? factorLabels[0]!);

  const footer = messages.footer(values.settlement, values.reliability);

  if (leaderParts.length > 0) {
    const leaders = leaderParts.join(messages.and);
    return `${messages.rankLead}${leaders}${messages.droveResult} — ${factorSentence}. ${footer}`;
  }

  return `${messages.rankLead}${factorSentence}. ${footer}`;
}
