import { ValidationError } from '../errors/index.js';
import {
  evaluateEnablementRecord,
  type LiveEnablementRecord,
  type LiveEnablementScope,
} from './live-enablement.js';
import type { PlatformMode } from './provider.js';

/**
 * The five shapes SELVO can charge in, split by how a regulator is likely to characterize them.
 *
 * Spec §18.3 deliberately refuses one switch for "transaction pricing": a fixed fee per decision
 * is software usage, whereas a percentage of notional looks like intermediation economics and a
 * share of savings is economic participation in the customer's outcome. Collapsing them into one
 * flag would mean enabling the cheap-to-justify shape also enables the expensive-to-justify one.
 */
export const PRICING_SHAPES = [
  'flat_txn',
  'tiered_txn',
  'ad_valorem',
  'gain_share',
  'tpv',
] as const;
export type PricingShape = (typeof PRICING_SHAPES)[number];

/**
 * Regulatory risk tier of a shape. `high` and `highest` cannot be enabled in production without a
 * written legal determination — see {@link HIGH_RISK_PRICING_SHAPES}.
 */
export const PRICING_SHAPE_RISK: Readonly<Record<PricingShape, 'low' | 'low_medium' | 'high' | 'highest'>> =
  {
    flat_txn: 'low',
    tiered_txn: 'low_medium',
    ad_valorem: 'high',
    gain_share: 'highest',
    tpv: 'high',
  };

/**
 * Shapes whose production activation requires a referenced legal opinion (§18.4).
 *
 * The gate is a document, not a code default and not a founder's opinion.
 */
export const HIGH_RISK_PRICING_SHAPES: readonly PricingShape[] = [
  'ad_valorem',
  'gain_share',
  'tpv',
];

export const PRICING_SHAPE_LABELS: Readonly<Record<PricingShape, string>> = {
  flat_txn: 'Flat per decision',
  tiered_txn: 'Tiered by size',
  ad_valorem: 'Ad valorem (% of notional)',
  gain_share: 'Gain share (% of savings)',
  tpv: 'TPV based',
};

export const PRICING_SHAPE_DESCRIPTIONS: Readonly<Record<PricingShape, string>> = {
  flat_txn:
    'A fixed amount per billable routing decision, identical regardless of transaction value.',
  tiered_txn: 'A fixed amount per size band. Near-usage pricing, still not a rate.',
  ad_valorem: 'A percentage of transaction notional. Platform markup and infrastructure surcharge.',
  gain_share: 'A share of platform revenue or of the savings produced. Partner commission.',
  tpv: 'Pricing driven by total payment volume rather than by decisions served.',
};

/** LiveEnablement scope that authorizes a given shape. One document per activity (§18.4). */
export const PRICING_SHAPE_ENABLEMENT_SCOPE: Readonly<
  Record<PricingShape, LiveEnablementScope | null>
> = {
  flat_txn: null,
  tiered_txn: null,
  ad_valorem: 'pricing_ad_valorem',
  gain_share: 'pricing_gain_share',
  tpv: 'pricing_tpv',
};

export function isPricingShape(value: unknown): value is PricingShape {
  return typeof value === 'string' && (PRICING_SHAPES as readonly string[]).includes(value);
}

export function isHighRiskPricingShape(shape: PricingShape): boolean {
  return HIGH_RISK_PRICING_SHAPES.includes(shape);
}

/** Operator flags, one per shape. Defaults live in the environment schema, not here. */
export type PricingShapeFlags = Readonly<Record<PricingShape, boolean>>;

/**
 * Legal determination referenced by a production flag flip.
 *
 * Both fields are required: an opinion is only meaningful for the jurisdiction it was written
 * for, so a determination for one market must not silently authorize another.
 */
export interface PricingLegalOpinionRef {
  readonly legalOpinionId: string;
  readonly jurisdiction: string;
}

export type PricingLegalOpinionRefs = Readonly<
  Partial<Record<PricingShape, PricingLegalOpinionRef>>
>;

export interface PricingShapeAdmissionInput {
  readonly mode: PlatformMode;
  readonly flags: PricingShapeFlags;
  readonly legalOpinions: PricingLegalOpinionRefs;
  /** Current LiveEnablement rows, keyed by scope. Absent entries fail closed. */
  readonly enablementRecords: Readonly<Partial<Record<LiveEnablementScope, LiveEnablementRecord>>>;
  readonly nowIso: string;
}

export interface PricingShapeDecision {
  readonly shape: PricingShape;
  readonly active: boolean;
  readonly flagEnabled: boolean;
  readonly riskTier: (typeof PRICING_SHAPE_RISK)[PricingShape];
  readonly legalOpinionId: string | null;
  readonly jurisdiction: string | null;
  /** Every reason the shape is not active, in a stable order. Empty when active. */
  readonly blockingReasons: readonly string[];
}

export interface PricingShapeAdmission {
  readonly mode: PlatformMode;
  readonly decisions: Readonly<Record<PricingShape, PricingShapeDecision>>;
  /** Convenience predicate used on the pricing hot path. */
  readonly isActive: (shape: PricingShape) => boolean;
  readonly activeShapes: readonly PricingShape[];
}

/**
 * Decide which pricing shapes may contribute to a customer charge.
 *
 * Fails closed on every axis. Outside production all five shapes follow their flags so revenue
 * models can be simulated freely (§18.3); in production a high-risk shape additionally needs a
 * referenced legal opinion *and* a current LiveEnablement record whose own license basis names
 * that opinion for that jurisdiction.
 */
export function evaluatePricingShapeAdmission(
  input: PricingShapeAdmissionInput,
): PricingShapeAdmission {
  const decisions = {} as Record<PricingShape, PricingShapeDecision>;
  for (const shape of PRICING_SHAPES) {
    decisions[shape] = decideShape(shape, input);
  }
  const activeShapes = PRICING_SHAPES.filter((shape) => decisions[shape].active);
  return {
    mode: input.mode,
    decisions,
    isActive: (shape) => decisions[shape].active,
    activeShapes,
  };
}

function decideShape(
  shape: PricingShape,
  input: PricingShapeAdmissionInput,
): PricingShapeDecision {
  const blockingReasons: string[] = [];
  const flagEnabled = input.flags[shape];
  if (!flagEnabled) {
    blockingReasons.push(`${flagNameFor(shape)}=false`);
  }

  const opinion = input.legalOpinions[shape] ?? null;
  const scope = PRICING_SHAPE_ENABLEMENT_SCOPE[shape];
  const needsOpinion = input.mode === 'production' && isHighRiskPricingShape(shape);

  if (needsOpinion) {
    if (opinion === null) {
      blockingReasons.push('legal_opinion_not_referenced');
    }
    if (scope === null) {
      blockingReasons.push('enablement_scope_undefined');
    } else {
      const record = input.enablementRecords[scope];
      const state = evaluateEnablementRecord(record ?? null, input.nowIso);
      if (!state.current) {
        blockingReasons.push(`${scope}:${state.reason ?? 'not_enabled'}`);
      } else if (opinion !== null && record !== undefined) {
        // The record must name this opinion and this jurisdiction. A determination recorded for
        // live execution or for another market does not authorize this shape.
        if (!record.signOff.licenseBasis.includes(opinion.legalOpinionId)) {
          blockingReasons.push('legal_opinion_id_mismatch');
        }
        if (record.region.trim().toUpperCase() !== opinion.jurisdiction.trim().toUpperCase()) {
          blockingReasons.push('legal_opinion_jurisdiction_mismatch');
        }
      }
    }
  }

  return {
    shape,
    active: blockingReasons.length === 0,
    flagEnabled,
    riskTier: PRICING_SHAPE_RISK[shape],
    legalOpinionId: opinion?.legalOpinionId ?? null,
    jurisdiction: opinion?.jurisdiction ?? null,
    blockingReasons,
  };
}

const FLAG_NAMES: Readonly<Record<PricingShape, string>> = {
  flat_txn: 'FLAT_TXN_PRICING_ENABLED',
  tiered_txn: 'TIERED_TXN_PRICING_ENABLED',
  ad_valorem: 'AD_VALOREM_PRICING_ENABLED',
  gain_share: 'GAIN_SHARE_ENABLED',
  tpv: 'TPV_PRICING_ENABLED',
};

export function flagNameFor(shape: PricingShape): string {
  return FLAG_NAMES[shape];
}

/**
 * Admission with every shape disabled. The value a caller gets when configuration is unavailable,
 * so an unresolved config produces a zero platform charge rather than an ungated one.
 */
export const NO_PRICING_SHAPES_ACTIVE: PricingShapeAdmission = {
  mode: 'sandbox',
  decisions: closedDecisions(),
  isActive: () => false,
  activeShapes: [],
};

function closedDecisions(): Record<PricingShape, PricingShapeDecision> {
  const decisions = {} as Record<PricingShape, PricingShapeDecision>;
  for (const shape of PRICING_SHAPES) {
    decisions[shape] = {
      shape,
      active: false,
      flagEnabled: false,
      riskTier: PRICING_SHAPE_RISK[shape],
      legalOpinionId: null,
      jurisdiction: null,
      blockingReasons: ['pricing_configuration_unavailable'],
    };
  }
  return decisions;
}

/**
 * Admission with the requested shapes active outside production.
 *
 * §18.3 allows all five shapes to run freely in SIMULATION and PARTNER_SANDBOX so revenue models
 * can be explored; only production requires the legal determination. Intended for modelling and
 * for tests — the `sandbox` mode is hard-coded so this cannot be used to bypass the production
 * gate.
 */
export function simulationPricingShapeAdmission(
  shapes: readonly PricingShape[] = PRICING_SHAPES,
): PricingShapeAdmission {
  const flags = {} as Record<PricingShape, boolean>;
  for (const shape of PRICING_SHAPES) {
    flags[shape] = shapes.includes(shape);
  }
  return evaluatePricingShapeAdmission({
    mode: 'sandbox',
    flags,
    legalOpinions: {},
    enablementRecords: {},
    nowIso: new Date(0).toISOString(),
  });
}

/**
 * Refuse to start when a high-risk shape is flagged on in production without its document.
 *
 * Called during container construction so a misconfigured deployment fails at boot rather than
 * charging ad valorem on the first request. The environment schema performs the synchronous half
 * of this check (flag on requires an opinion id and jurisdiction); this is the half that needs
 * the recorded LiveEnablement row.
 */
export function assertPricingShapeAdmissionSafe(admission: PricingShapeAdmission): void {
  if (admission.mode !== 'production') {
    return;
  }
  const violations = HIGH_RISK_PRICING_SHAPES.filter((shape) => {
    const decision = admission.decisions[shape];
    return decision.flagEnabled && !decision.active;
  });
  if (violations.length === 0) {
    return;
  }
  throw new ValidationError(
    'A high-risk pricing shape is enabled in production without a current legal determination. ' +
      'Set the flag to false or record a LiveEnablement row naming the referenced legal opinion ' +
      'and jurisdiction for that specific activity.',
    {
      shapes: violations.map((shape) => ({
        shape,
        flag: flagNameFor(shape),
        blockingReasons: [...admission.decisions[shape].blockingReasons],
      })),
    },
  );
}
