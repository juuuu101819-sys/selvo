import {
  ConfigurationError,
  DEFAULT_ROUTING_WEIGHTS,
  DEFAULT_SCORING_WEIGHTS,
  PLATFORM_MODES,
  parseRoutingWeights,
  parseScoringWeights,
  type SerializedRoutingWeights,
  type SerializedScoringWeights,
} from '@meridian/core';
import { PERSISTENCE_DRIVERS } from '@meridian/persistence';
import { z } from 'zod';

const decimalString = z.string().regex(/^\d+(\.\d+)?$/, 'must be a non-negative decimal string');

/**
 * Configuration schema.
 *
 * Everything the application needs arrives through the environment and is validated exactly once,
 * at startup. A misconfigured deployment fails immediately with a precise message instead of
 * surfacing as a strange 500 on the first request. No secret is ever read from source (rule 4).
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
    ROUTING_WEIGHT_LIQUIDITY: decimalString.default(DEFAULT_ROUTING_WEIGHTS.liquidity),
    ROUTING_WEIGHT_RELIABILITY: decimalString.default(DEFAULT_ROUTING_WEIGHTS.reliability),
    ROUTING_WEIGHT_SETTLEMENT_CONFIDENCE: decimalString.default(
      DEFAULT_ROUTING_WEIGHTS.settlementConfidence,
    ),
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
  });

export type RawEnv = z.infer<typeof envSchema>;

export interface AppConfig {
  readonly nodeEnv: RawEnv['NODE_ENV'];
  readonly mode: RawEnv['PLATFORM_MODE'];
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

  const routingWeights = {
    cost: env.ROUTING_WEIGHT_COST,
    speed: env.ROUTING_WEIGHT_SPEED,
    liquidity: env.ROUTING_WEIGHT_LIQUIDITY,
    reliability: env.ROUTING_WEIGHT_RELIABILITY,
    settlementConfidence: env.ROUTING_WEIGHT_SETTLEMENT_CONFIDENCE,
  };
  parseRoutingWeights(routingWeights);

  return {
    nodeEnv: env.NODE_ENV,
    mode: env.PLATFORM_MODE,
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
