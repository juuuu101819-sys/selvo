import {
  ConfigurationError,
  DEFAULT_ROUTING_WEIGHTS,
  DEFAULT_SCORING_WEIGHTS,
  PLATFORM_MODES,
  PRODUCTION_AUTH_SECRET_MIN_LENGTH,
  deriveDataEncryptionKeyHex,
  deriveSessionTokenPepper,
  isForbiddenProductionSecret,
  parseRoutingWeights,
  parseScoringWeights,
  type BillingCollectionMode,
  type PricingLegalOpinionRef,
  type PricingLegalOpinionRefs,
  type PricingShapeFlags,
  type SerializedRoutingWeights,
  type SerializedScoringWeights,
} from '@meridian/core';
import { PERSISTENCE_DRIVERS } from '@meridian/persistence';
import { z } from 'zod';

const decimalString = z.string().regex(/^\d+(\.\d+)?$/, 'must be a non-negative decimal string');
const booleanFlag = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');
/** For flags that are on at launch. Still explicitly overridable to `false`. */
const booleanFlagOn = z
  .enum(['true', 'false'])
  .default('true')
  .transform((value) => value === 'true');
/** Reference to a written legal determination. Never a placeholder — see §18.4. */
const legalOpinionId = z.string().min(3).max(128).optional();
const jurisdictionCode = z
  .string()
  .regex(/^[A-Z]{2}$/, 'must be an ISO 3166-1 alpha-2 code or EU')
  .or(z.literal('EU'))
  .optional();

/**
 * Configuration schema.
 *
 * Everything the application needs arrives through the environment and is validated exactly once,
 * at startup. A misconfigured deployment fails immediately with a precise message instead of
 * surfacing as a strange 500 on the first request. No secret is ever read from source (rule 4).
 * Secret values are never copied onto {@link AppConfig} and must never be logged.
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PLATFORM_MODE: z.enum(PLATFORM_MODES).default('sandbox'),

    API_HOST: z.string().min(1).default('127.0.0.1'),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(47_311),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    LOG_PRETTY: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    CORS_ORIGINS: z.string().default('http://127.0.0.1:43117,http://localhost:43117'),

    DATABASE_DRIVER: z.enum(PERSISTENCE_DRIVERS).default('memory'),
    DATABASE_URL: z.string().min(1).optional(),
    DATABASE_MAX_CONNECTIONS: z.coerce.number().int().min(1).max(100).default(10),
    DATABASE_SSL: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),

    /**
     * Operator claim that licensed partner quotes may be routed in production.
     * Independently false from {@link PRODUCTION_EXECUTION_AVAILABLE}. Default false.
     */
    PRODUCTION_ROUTING_AVAILABLE: booleanFlag,
    /**
     * Operator claim that partner execution is available. Always rejected: execution is not
     * implemented and `POST /executions` remains 501.
     */
    PRODUCTION_EXECUTION_AVAILABLE: booleanFlag,

    /**
     * Signed mandate verification/storage (AP2, x402, MPP). Default false — fail closed.
     * Does not enable execution. POST /executions remains 501.
     */
    MANDATE_INGESTION_ENABLED: booleanFlag,

    /**
     * Admit `kind: 'live'` execution-partner adapters. Default false.
     * See GO_LIVE_CHECKLIST.md. Even when true the registry still refuses unimplemented
     * adapters; per-corridor/per-partner live also requires recorded legal sign-off.
     * POST /executions remains 501 for principal execution.
     */
    PARTNER_LIVE_ENABLED: booleanFlag,

    /**
     * Sandbox execution orchestration against mock partners. Default false — fail closed.
     * When false, POST /executions remains 501. Production-locked processes cannot enable this.
     * Does not enable live partners, custody, or principal execution.
     * Not a corridor live flag — see GO_LIVE_CHECKLIST.md.
     */
    EXECUTION_ENABLED: booleanFlag,

    /**
     * How long a generated settlement instruction stays usable, in seconds.
     *
     * Capped further at generation by the quote's own expiry, so this is a ceiling and not a
     * promise. Short by default: an instruction carries a signature, which makes a stale price
     * look current to anyone who does not check the dates.
     */
    SETTLEMENT_INSTRUCTION_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(900),

    /**
     * Real invoice collection, live subscription charging, and partner payouts.
     * Default false — invoice recording only. See GO_LIVE_CHECKLIST.md#billing-collection.
     * Even when true, collection still requires recorded legal sign-off, a confirmed legal
     * entity, and a processor adapter (none of which this repository invents).
     */
    BILLING_LIVE_ENABLED: booleanFlag,

    // -----------------------------------------------------------------------
    // Pricing-shape flags (§18.3). One flag per shape, split by regulatory risk:
    // enabling the shape that is cheap to justify must not enable the expensive one.
    // A `false` flag fails closed — the shape contributes zero to any customer charge and is
    // excluded from customer-facing revenue reporting. Outside production all five follow their
    // flags so revenue models can be simulated freely.
    // -----------------------------------------------------------------------

    /**
     * Fixed amount per billable routing decision, independent of transaction value.
     * Low risk (software usage pricing) and on at launch. Size-independence is enforced by
     * {@link flatDecisionFee} and its regression test, not by convention.
     */
    FLAT_TXN_PRICING_ENABLED: booleanFlagOn,

    /** Fixed amount per size band. Built, off at launch. Low–medium risk. */
    TIERED_TXN_PRICING_ENABLED: booleanFlag,

    /**
     * Percentage of transaction notional (platform markup, infrastructure surcharge).
     * HIGH risk: it looks like intermediation economics. Requires AD_VALOREM_LEGAL_OPINION_ID
     * plus a current `pricing_ad_valorem` LiveEnablement record in production (§18.4).
     */
    AD_VALOREM_PRICING_ENABLED: booleanFlag,

    /**
     * Share of platform revenue or of customer savings (partner commission).
     * HIGHEST risk: economic participation in the customer's outcome. Requires
     * GAIN_SHARE_LEGAL_OPINION_ID plus a current `pricing_gain_share` record in production.
     */
    GAIN_SHARE_ENABLED: booleanFlag,

    /**
     * Pricing driven by total payment volume. HIGH risk: volume-of-money economics.
     * Requires TPV_LEGAL_OPINION_ID plus a current `pricing_tpv` record in production.
     */
    TPV_PRICING_ENABLED: booleanFlag,

    /**
     * Written legal determinations backing the high-risk shapes, and the jurisdiction each was
     * written for. An opinion is only meaningful for its own market, so both halves are required
     * and both must match the recorded LiveEnablement row.
     */
    AD_VALOREM_LEGAL_OPINION_ID: legalOpinionId,
    AD_VALOREM_JURISDICTION: jurisdictionCode,
    GAIN_SHARE_LEGAL_OPINION_ID: legalOpinionId,
    GAIN_SHARE_JURISDICTION: jurisdictionCode,
    TPV_LEGAL_OPINION_ID: legalOpinionId,
    TPV_JURISDICTION: jurisdictionCode,
    /** Same discipline for live cash collection: entity, tax handling, processor contract. */
    BILLING_LEGAL_OPINION_ID: legalOpinionId,
    BILLING_JURISDICTION: jurisdictionCode,

    /**
     * Deployment label. Safety rules come from production-lock (PA-C01–C03), not from this value.
     * `staging` and `production` both require a production-locked process. Staging is not a
     * relaxed sandbox.
     */
    DEPLOY_ENV: z.enum(['development', 'staging', 'production']).optional(),
    /** Build/image identifier for rollback. Never a secret. */
    MERIDIAN_IMAGE_TAG: z.string().min(1).max(128).optional(),

    SEED_DEMO_TENANTS: booleanFlag,

    /**
     * Production-only process secret. Required when NODE_ENV or PLATFORM_MODE is production.
     * Never stored on AppConfig; only {@link AppConfig.authSecretConfigured} is retained.
     */
    AUTH_SECRET: z.string().min(1).optional(),
    /**
     * Sales-ops secret for invite-only org provisioning and KYB/pricing review.
     * Optional at process start (ops endpoints 401 if unset). Never copied onto AppConfig.
     */
    ONBOARDING_OPERATOR_SECRET: z.string().min(1).optional(),

    // Defaults taken from the engine rather than repeated here, so the running service and the
    // platform default cannot drift apart.
    ROUTE_WEIGHT_COST: decimalString.default(DEFAULT_SCORING_WEIGHTS.cost),
    ROUTE_WEIGHT_SPEED: decimalString.default(DEFAULT_SCORING_WEIGHTS.speed),
    ROUTE_WEIGHT_RELIABILITY: decimalString.default(DEFAULT_SCORING_WEIGHTS.reliability),
    ROUTE_WEIGHT_SLIPPAGE: decimalString.default(DEFAULT_SCORING_WEIGHTS.slippage),
    ROUTE_WEIGHT_LIQUIDITY: decimalString.default(DEFAULT_SCORING_WEIGHTS.liquidity),
    ROUTE_WEIGHT_RISK: decimalString.default(DEFAULT_SCORING_WEIGHTS.risk),
    ROUTING_WEIGHT_COST: decimalString.default(DEFAULT_ROUTING_WEIGHTS.cost),
    ROUTING_WEIGHT_SPEED: decimalString.default(DEFAULT_ROUTING_WEIGHTS.speed),
    ROUTING_WEIGHT_FINALITY: decimalString.default(DEFAULT_ROUTING_WEIGHTS.finality),
    ROUTING_WEIGHT_FX_RATE: decimalString.default(DEFAULT_ROUTING_WEIGHTS.fxRate),
    ROUTING_WEIGHT_SLIPPAGE: decimalString.default(DEFAULT_ROUTING_WEIGHTS.slippage),
    ROUTING_WEIGHT_LIQUIDITY: decimalString.default(DEFAULT_ROUTING_WEIGHTS.liquidity),
    ROUTING_WEIGHT_COMPLIANCE: decimalString.default(DEFAULT_ROUTING_WEIGHTS.compliance),
    PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(4_000),

    /** Overrides the bundled sandbox pricing dataset. */
    MERIDIAN_PRICING_DATA_DIR: z.string().min(1).optional(),

    /** Maximum comparison notional, as a guard against nonsense input. */
    MAX_COMPARISON_AMOUNT_MINOR_UNITS: z.string().regex(/^\d+$/).default('100000000000000'),

    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(60_000),
    /** When unset, tests disable the limiter. Set to enable it (including in NODE_ENV=test). */
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10_000).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.DATABASE_DRIVER === 'postgres' && env.DATABASE_URL === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'DATABASE_URL is required when DATABASE_DRIVER is "postgres".',
      });
    }

    const productionLocked = isProductionLocked(env.NODE_ENV, env.PLATFORM_MODE);

    if (productionLocked && env.DATABASE_DRIVER === 'memory') {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_DRIVER'],
        message:
          'DATABASE_DRIVER=memory is forbidden when NODE_ENV=production or PLATFORM_MODE=production. ' +
          'Production requires an approved persistent database (postgres). The driver is not switched automatically.',
      });
    } else if (productionLocked && env.DATABASE_DRIVER !== 'postgres') {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_DRIVER'],
        message:
          'Production requires DATABASE_DRIVER=postgres (the only approved persistent production database). ' +
          'The driver is not switched automatically.',
      });
    }

    if (env.PRODUCTION_EXECUTION_AVAILABLE) {
      ctx.addIssue({
        code: 'custom',
        path: ['PRODUCTION_EXECUTION_AVAILABLE'],
        message:
          'PRODUCTION_EXECUTION_AVAILABLE cannot be true. Partner execution is not implemented; ' +
          'POST /api/v1/executions remains 501. A production environment with no licensed execution ' +
          'partner must never pretend that execution is available.',
      });
    }

    if (env.EXECUTION_ENABLED && productionLocked) {
      ctx.addIssue({
        code: 'custom',
        path: ['EXECUTION_ENABLED'],
        message:
          'EXECUTION_ENABLED cannot be true in a production-locked process. Sandbox orchestration ' +
          'is sandbox-mode only; live partners and custody are out of scope.',
      });
    }

    // §18.4 — a high-risk pricing shape may only be flipped on against a referenced written legal
    // determination for a named jurisdiction. Rejected at config load, not silently ignored. The
    // matching LiveEnablement row is checked at container construction, which is the half of the
    // gate that needs a database read.
    const gatedShapes = [
      {
        flag: 'AD_VALOREM_PRICING_ENABLED',
        enabled: env.AD_VALOREM_PRICING_ENABLED,
        opinionKey: 'AD_VALOREM_LEGAL_OPINION_ID',
        opinion: env.AD_VALOREM_LEGAL_OPINION_ID,
        jurisdictionKey: 'AD_VALOREM_JURISDICTION',
        jurisdiction: env.AD_VALOREM_JURISDICTION,
      },
      {
        flag: 'GAIN_SHARE_ENABLED',
        enabled: env.GAIN_SHARE_ENABLED,
        opinionKey: 'GAIN_SHARE_LEGAL_OPINION_ID',
        opinion: env.GAIN_SHARE_LEGAL_OPINION_ID,
        jurisdictionKey: 'GAIN_SHARE_JURISDICTION',
        jurisdiction: env.GAIN_SHARE_JURISDICTION,
      },
      {
        flag: 'TPV_PRICING_ENABLED',
        enabled: env.TPV_PRICING_ENABLED,
        opinionKey: 'TPV_LEGAL_OPINION_ID',
        opinion: env.TPV_LEGAL_OPINION_ID,
        jurisdictionKey: 'TPV_JURISDICTION',
        jurisdiction: env.TPV_JURISDICTION,
      },
      {
        flag: 'BILLING_LIVE_ENABLED',
        enabled: env.BILLING_LIVE_ENABLED,
        opinionKey: 'BILLING_LEGAL_OPINION_ID',
        opinion: env.BILLING_LEGAL_OPINION_ID,
        jurisdictionKey: 'BILLING_JURISDICTION',
        jurisdiction: env.BILLING_JURISDICTION,
      },
    ] as const;

    for (const gate of gatedShapes) {
      if (!gate.enabled) {
        continue;
      }
      if (gate.opinion === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [gate.opinionKey],
          message:
            `${gate.flag}=true requires ${gate.opinionKey}: a written legal determination for ` +
            'this specific activity. The gate is a document, not a code default. Set the flag ' +
            'to false or reference the opinion.',
        });
      }
      if (gate.jurisdiction === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [gate.jurisdictionKey],
          message:
            `${gate.flag}=true requires ${gate.jurisdictionKey}. A legal determination is only ` +
            'valid for the jurisdiction it was written for and must not authorize another.',
        });
      }
    }

    if (env.PRODUCTION_ROUTING_AVAILABLE && env.PLATFORM_MODE !== 'production') {
      ctx.addIssue({
        code: 'custom',
        path: ['PRODUCTION_ROUTING_AVAILABLE'],
        message: 'PRODUCTION_ROUTING_AVAILABLE is only valid when PLATFORM_MODE=production.',
      });
    }

    const deployEnv =
      env.DEPLOY_ENV ?? (productionLocked ? 'production' : 'development');

    if ((deployEnv === 'staging' || deployEnv === 'production') && !productionLocked) {
      ctx.addIssue({
        code: 'custom',
        path: ['DEPLOY_ENV'],
        message:
          `DEPLOY_ENV=${deployEnv} requires NODE_ENV=production or PLATFORM_MODE=production. ` +
          'Staging is not a relaxed sandbox; it uses the same fail-closed gates as production.',
      });
    }

    if (productionLocked && deployEnv === 'development') {
      ctx.addIssue({
        code: 'custom',
        path: ['DEPLOY_ENV'],
        message:
          'A production-locked process cannot be labelled DEPLOY_ENV=development. Use staging or production.',
      });
    }

    if (productionLocked && env.SEED_DEMO_TENANTS) {
      ctx.addIssue({
        code: 'custom',
        path: ['SEED_DEMO_TENANTS'],
        message:
          'SEED_DEMO_TENANTS cannot be true when NODE_ENV=production or PLATFORM_MODE=production.',
      });
    }

    if (productionLocked) {
      const authSecret = env.AUTH_SECRET;
      if (authSecret === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['AUTH_SECRET'],
          message:
            'AUTH_SECRET is required when NODE_ENV=production or PLATFORM_MODE=production. ' +
            'Set an explicit production secret via the environment; demo and default credentials are rejected.',
        });
      } else if (isForbiddenProductionSecret(authSecret)) {
        ctx.addIssue({
          code: 'custom',
          path: ['AUTH_SECRET'],
          message:
            'AUTH_SECRET must not be a demo password, demo secret, or default credential fallback.',
        });
      } else if (authSecret.length < PRODUCTION_AUTH_SECRET_MIN_LENGTH) {
        ctx.addIssue({
          code: 'custom',
          path: ['AUTH_SECRET'],
          message: `AUTH_SECRET must be at least ${PRODUCTION_AUTH_SECRET_MIN_LENGTH} characters. Do not use a demo or default secret.`,
        });
      }
    }

    if (env.ONBOARDING_OPERATOR_SECRET !== undefined) {
      if (isForbiddenProductionSecret(env.ONBOARDING_OPERATOR_SECRET)) {
        ctx.addIssue({
          code: 'custom',
          path: ['ONBOARDING_OPERATOR_SECRET'],
          message:
            'ONBOARDING_OPERATOR_SECRET must not be a demo password, demo secret, or default credential fallback.',
        });
      } else if (env.ONBOARDING_OPERATOR_SECRET.length < PRODUCTION_AUTH_SECRET_MIN_LENGTH) {
        ctx.addIssue({
          code: 'custom',
          path: ['ONBOARDING_OPERATOR_SECRET'],
          message: `ONBOARDING_OPERATOR_SECRET must be at least ${PRODUCTION_AUTH_SECRET_MIN_LENGTH} characters.`,
        });
      }
    }
  });

export type RawEnv = z.infer<typeof envSchema>;

export interface ProductionGates {
  /** Licensed partner quotes may be offered. Independent of {@link executionAvailable}. */
  readonly routingAvailable: boolean;
  /** Partner execution may be offered. Always false until the compliance gate is satisfied. */
  readonly executionAvailable: boolean;
}

export type DeployEnvironment = 'development' | 'staging' | 'production';

export interface DeploymentInfo {
  readonly environment: DeployEnvironment;
  /** Image or git tag from MERIDIAN_IMAGE_TAG. Not a secret. */
  readonly imageTag: string | null;
}

export interface AppConfig {
  readonly nodeEnv: RawEnv['NODE_ENV'];
  readonly mode: RawEnv['PLATFORM_MODE'];
  /** True when NODE_ENV=production or PLATFORM_MODE=production. */
  readonly productionLocked: boolean;
  readonly deployment: DeploymentInfo;
  readonly productionGates: ProductionGates;
  /**
   * HTTP mandate ingestion. Default false. Verification/storage only — never execution.
   */
  readonly mandateIngestionEnabled: boolean;
  /**
   * Live execution-partner adapters. Default false. No live adapters are registered in this tree.
   */
  readonly partnerLiveEnabled: boolean;
  /**
   * Sandbox orchestration of POST /executions. Default false. When false the route stays 501.
   */
  readonly executionEnabled: boolean;
  /** Ceiling on settlement-instruction usability. Quote expiry may shorten it further. */
  readonly settlementInstructionTtlSeconds: number;
  /**
   * Live billing collection / subscriptions / partner payouts. Default false.
   * See GO_LIVE_CHECKLIST.md#billing-collection.
   */
  readonly billingLiveEnabled: boolean;
  /**
   * Which collection mode the process runs in (§18.5).
   *
   * `RECORD_ONLY` computes and records invoices and never contacts a processor; `LIVE` permits a
   * contracted processor adapter to collect. Derived from {@link billingLiveEnabled} so there is
   * one switch rather than two that can disagree.
   */
  readonly billingCollectionMode: BillingCollectionMode;
  /**
   * Per-shape pricing flags (§18.3). A `false` shape contributes zero to any customer charge and
   * is excluded from customer-facing revenue reporting.
   */
  readonly pricingShapeFlags: PricingShapeFlags;
  /**
   * Written legal determinations referenced by the high-risk shapes. Present only when both the
   * opinion id and its jurisdiction were supplied; a half-configured gate stays closed.
   */
  readonly pricingLegalOpinions: PricingLegalOpinionRefs;
  /** Legal determination referenced by BILLING_LIVE_ENABLED, if any. */
  readonly billingLegalOpinion: PricingLegalOpinionRef | null;
  /** Whether AUTH_SECRET was supplied. The secret value is never retained. */
  readonly authSecretConfigured: boolean;
  /**
   * HMAC key for session-token hashing, derived from AUTH_SECRET (never AUTH_SECRET itself).
   * Development/test without AUTH_SECRET uses a documented non-secret derivation so HMAC is still
   * used. Production-locked processes already require AUTH_SECRET.
   */
  readonly sessionTokenPepper: string;
  /**
   * AES-256 key (hex) for TOTP secrets and OIDC client secrets at rest, derived from AUTH_SECRET.
   * AUTH_SECRET itself is never retained.
   */
  readonly dataEncryptionKey: string;
  readonly seedDemoTenants: boolean;
  readonly host: string;
  readonly port: number;
  readonly logLevel: RawEnv['LOG_LEVEL'];
  readonly logPretty: boolean;
  readonly corsOrigins: readonly string[];
  readonly database: {
    readonly driver: RawEnv['DATABASE_DRIVER'];
    readonly url: string | undefined;
    readonly maxConnections: number;
    readonly ssl: boolean;
  };
  readonly weights: SerializedScoringWeights;
  readonly routingWeights: SerializedRoutingWeights;
  readonly providerTimeoutMs: number;
  readonly pricingDataDir: string | undefined;
  readonly maxAmountMinorUnits: string;
  readonly rateLimit: {
    readonly enabled: boolean;
    readonly windowMs: number;
    readonly max: number;
  };
}

export function isProductionLocked(nodeEnv: string, mode: string): boolean {
  return nodeEnv === 'production' || mode === 'production';
}

/**
 * Demo tenants are sandbox fixtures. Production-locked processes never seed them. Tests seed only
 * when SEED_DEMO_TENANTS=true (Playwright). Local development keeps the historical auto-seed.
 */
export function shouldProvisionDemoTenants(config: AppConfig): boolean {
  if (config.productionLocked) {
    return false;
  }
  if (config.nodeEnv === 'test') {
    return config.seedDemoTenants;
  }
  return true;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new ConfigurationError('Invalid environment configuration.', {
      issues: parsed.error.issues.map((issue) => ({
        variable: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  const env = parsed.data;
  const productionLocked = isProductionLocked(env.NODE_ENV, env.PLATFORM_MODE);
  const deployEnv: DeployEnvironment =
    env.DEPLOY_ENV ?? (productionLocked ? 'production' : 'development');

  const weights = {
    cost: env.ROUTE_WEIGHT_COST,
    speed: env.ROUTE_WEIGHT_SPEED,
    reliability: env.ROUTE_WEIGHT_RELIABILITY,
    slippage: env.ROUTE_WEIGHT_SLIPPAGE,
    liquidity: env.ROUTE_WEIGHT_LIQUIDITY,
    risk: env.ROUTE_WEIGHT_RISK,
  };
  // Surfaces a bad weight set as a startup failure rather than a per-request 400.
  parseScoringWeights(weights);

  const legalOpinionRefs = (source: typeof env): PricingLegalOpinionRefs => {
    const refs: Record<string, PricingLegalOpinionRef> = {};
    const pairs = [
      ['ad_valorem', source.AD_VALOREM_LEGAL_OPINION_ID, source.AD_VALOREM_JURISDICTION],
      ['gain_share', source.GAIN_SHARE_LEGAL_OPINION_ID, source.GAIN_SHARE_JURISDICTION],
      ['tpv', source.TPV_LEGAL_OPINION_ID, source.TPV_JURISDICTION],
    ] as const;
    for (const [shape, opinionId, jurisdiction] of pairs) {
      if (opinionId !== undefined && jurisdiction !== undefined) {
        refs[shape] = { legalOpinionId: opinionId, jurisdiction };
      }
    }
    return refs;
  };

  const routingWeights = {
    cost: env.ROUTING_WEIGHT_COST,
    speed: env.ROUTING_WEIGHT_SPEED,
    finality: env.ROUTING_WEIGHT_FINALITY,
    fxRate: env.ROUTING_WEIGHT_FX_RATE,
    slippage: env.ROUTING_WEIGHT_SLIPPAGE,
    liquidity: env.ROUTING_WEIGHT_LIQUIDITY,
    compliance: env.ROUTING_WEIGHT_COMPLIANCE,
  };
  parseRoutingWeights(routingWeights);

  return {
    nodeEnv: env.NODE_ENV,
    mode: env.PLATFORM_MODE,
    productionLocked,
    deployment: {
      environment: deployEnv,
      imageTag: env.MERIDIAN_IMAGE_TAG ?? null,
    },
    productionGates: {
      routingAvailable: env.PRODUCTION_ROUTING_AVAILABLE,
      executionAvailable: false,
    },
    mandateIngestionEnabled: env.MANDATE_INGESTION_ENABLED,
    settlementInstructionTtlSeconds: env.SETTLEMENT_INSTRUCTION_TTL_SECONDS,
    partnerLiveEnabled: env.PARTNER_LIVE_ENABLED,
    executionEnabled: env.EXECUTION_ENABLED,
    billingLiveEnabled: env.BILLING_LIVE_ENABLED,
    billingCollectionMode: env.BILLING_LIVE_ENABLED ? 'LIVE' : 'RECORD_ONLY',
    pricingShapeFlags: {
      flat_txn: env.FLAT_TXN_PRICING_ENABLED,
      tiered_txn: env.TIERED_TXN_PRICING_ENABLED,
      ad_valorem: env.AD_VALOREM_PRICING_ENABLED,
      gain_share: env.GAIN_SHARE_ENABLED,
      tpv: env.TPV_PRICING_ENABLED,
    },
    pricingLegalOpinions: legalOpinionRefs(env),
    billingLegalOpinion:
      env.BILLING_LEGAL_OPINION_ID === undefined || env.BILLING_JURISDICTION === undefined
        ? null
        : {
            legalOpinionId: env.BILLING_LEGAL_OPINION_ID,
            jurisdiction: env.BILLING_JURISDICTION,
          },
    authSecretConfigured: env.AUTH_SECRET !== undefined && env.AUTH_SECRET.length > 0,
    sessionTokenPepper: deriveSessionTokenPepper(env.AUTH_SECRET, { productionLocked }),
    dataEncryptionKey: deriveDataEncryptionKeyHex(env.AUTH_SECRET, { productionLocked }),
    seedDemoTenants: env.SEED_DEMO_TENANTS,
    host: env.API_HOST,
    port: env.API_PORT,
    logLevel: env.LOG_LEVEL,
    logPretty: env.LOG_PRETTY,
    corsOrigins: env.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin !== ''),
    database: {
      driver: env.DATABASE_DRIVER,
      url: env.DATABASE_URL,
      maxConnections: env.DATABASE_MAX_CONNECTIONS,
      ssl: env.DATABASE_SSL,
    },
    weights,
    routingWeights,
    providerTimeoutMs: env.PROVIDER_TIMEOUT_MS,
    pricingDataDir: env.MERIDIAN_PRICING_DATA_DIR,
    maxAmountMinorUnits: env.MAX_COMPARISON_AMOUNT_MINOR_UNITS,
    rateLimit: {
      enabled: env.NODE_ENV !== 'test' || source['RATE_LIMIT_MAX'] !== undefined,
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      max: env.RATE_LIMIT_MAX ?? 120,
    },
  };
}

/** Sandbox responses carry this so an indicative price is never mistaken for an executable one. */
export const SANDBOX_DISCLAIMER =
  'Indicative sandbox pricing. Routes are estimates from synthetic reference data, are not ' +
  'executable, and Meridian neither custodies funds nor executes transactions.';

export const PRODUCTION_DISCLAIMER =
  'Indicative pricing from licensed partner quotes. Meridian is non-custodial and does not ' +
  'execute transactions; transact directly with the recommended provider.';

export function disclaimerFor(mode: AppConfig['mode']): string {
  return mode === 'sandbox' ? SANDBOX_DISCLAIMER : PRODUCTION_DISCLAIMER;
}
