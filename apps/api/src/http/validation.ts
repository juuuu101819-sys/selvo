import {
  Money,
  RAIL_FAMILIES,
  RAIL_TYPES,
  SUPPORTED_CURRENCIES,
  ValidationError,
  assertAssetCode,
  currencyExponent,
  resolveRailFilter,
  toAssetMinorUnits,
  type CurrencyCode,
  type RailType,
} from '@meridian/core';
import { z } from 'zod';

const currencyCode = z.enum(SUPPORTED_CURRENCIES as [CurrencyCode, ...CurrencyCode[]]);

const decimalAmount = z
  .string()
  .trim()
  .regex(/^\d{1,18}(\.\d{1,6})?$/, 'must be a positive decimal amount in major units');

const weight = z.string().regex(/^\d+(\.\d+)?$/, 'must be a non-negative decimal string');

/**
 * Body of `POST /v1/comparisons`.
 *
 * `.strict()` matters for more than tidiness: rejecting unknown keys means beneficiary details,
 * account numbers or identity data cannot be smuggled into a request the platform has no lawful
 * basis to store (see docs/COMPLIANCE.md).
 */
export const createComparisonSchema = z
  .object({
    sourceCurrency: currencyCode,
    /**
     * The receiving currency.
     *
     * `destinationCurrency` is accepted as a synonym because both names are in common use for the
     * same concept, and rejecting a request over the choice of word would be pedantry rather than
     * validation. Exactly one must be supplied.
     */
    targetCurrency: currencyCode.optional(),
    destinationCurrency: currencyCode.optional(),
    /** Send amount in major units, e.g. `"100000.00"`. */
    amount: decimalAmount,
    rails: z.array(z.enum(RAIL_TYPES)).min(1).max(RAIL_TYPES.length).optional(),
    /**
     * Restrict the comparison to every currently priced rail in these families.
     *
     * Combined with `rails` as an intersection. Planned rails (DEX, treasury) never expand.
     */
    railFamilies: z.array(z.enum(RAIL_FAMILIES)).min(1).max(RAIL_FAMILIES.length).optional(),
    weights: z.object({ cost: weight, speed: weight, reliability: weight }).strict().optional(),
  })
  .strict()
  .refine((body) => (body.targetCurrency ?? body.destinationCurrency) !== undefined, {
    message: 'either targetCurrency or destinationCurrency is required',
    path: ['targetCurrency'],
  })
  .refine(
    (body) =>
      body.targetCurrency === undefined ||
      body.destinationCurrency === undefined ||
      body.targetCurrency === body.destinationCurrency,
    {
      message: 'targetCurrency and destinationCurrency must agree when both are supplied',
      path: ['destinationCurrency'],
    },
  )
  .refine((body) => body.sourceCurrency !== (body.targetCurrency ?? body.destinationCurrency), {
    message: 'sourceCurrency and targetCurrency must differ',
    path: ['targetCurrency'],
  });

/** Resolves the receiving currency from either accepted field name. */
export function resolveTargetCurrency(body: CreateComparisonBody): CurrencyCode {
  const target = body.targetCurrency ?? body.destinationCurrency;
  if (target === undefined) {
    throw new ValidationError('A receiving currency is required.', {});
  }
  return target;
}

export type CreateComparisonBody = z.infer<typeof createComparisonSchema>;

/**
 * Turns `rails` and `railFamilies` into the engine's rail filter.
 *
 * `null` means every rail. An empty result means the caller asked for a family that has no
 * priced rails yet (DeFi) or combined filters that cannot overlap — that is a 400, not a 422.
 */
export function resolveRequestedRails(body: CreateComparisonBody): readonly RailType[] | null {
  const rails = resolveRailFilter({
    ...(body.rails === undefined ? {} : { rails: body.rails }),
    ...(body.railFamilies === undefined ? {} : { families: body.railFamilies }),
  });
  if (rails !== null && rails.length === 0) {
    throw new ValidationError(
      'No priced rail matches the requested rails and families. DeFi and treasury rails are planned.',
      {
        rails: body.rails ?? null,
        railFamilies: body.railFamilies ?? null,
      },
    );
  }
  return rails;
}

export const comparisonIdParamsSchema = z
  .object({ comparisonId: z.string().min(1).max(128) })
  .strict();

export const providerIdParamsSchema = z
  .object({ providerId: z.string().trim().min(1).max(128) })
  .strict();

export const listQuerySchema = z
  .object({ limit: z.coerce.number().int().min(1).max(100).default(20) })
  .strict();

export const idempotencyKeySchema = z.string().trim().min(8).max(128).optional();

/** Parses input against a schema, converting a failure into the platform's `ValidationError`. */
export function parseOrThrow<TSchema extends z.ZodType>(
  schema: TSchema,
  value: unknown,
  location: 'body' | 'params' | 'query' | 'headers',
): z.infer<TSchema> {
  const result = schema.safeParse(value);
  if (result.success) {
    return result.data;
  }
  throw new ValidationError(`Invalid request ${location}.`, {
    location,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  });
}

/**
 * Converts a major-unit amount string into exact minor units.
 *
 * An amount carrying more precision than the currency has is rejected rather than rounded: a
 * request for `1000.005 USD` is ambiguous, and silently resolving it either way would mean the
 * customer was quoted on an amount they did not ask for.
 */
export function toMinorUnits(
  currency: CurrencyCode,
  amount: string,
  maxMinorUnits: string,
): string {
  const [, fraction = ''] = amount.split('.');
  const exponent = currencyExponent(currency);
  if (fraction.replace(/0+$/, '').length > exponent) {
    throw new ValidationError(
      `${currency} supports ${exponent} decimal place${exponent === 1 ? '' : 's'}; ` +
        `"${amount}" is more precise than the currency allows.`,
      { currency, amount, exponent },
    );
  }

  const money = Money.fromDecimal(currency, amount);
  if (!money.isPositive()) {
    throw new ValidationError('Amount must be greater than zero.', { currency, amount });
  }
  if (money.minorUnits > BigInt(maxMinorUnits)) {
    throw new ValidationError(
      `Amount exceeds the maximum comparable notional for this deployment.`,
      { currency, amount, maxMinorUnits },
    );
  }
  return money.minorUnits.toString();
}

const assetAmount = z
  .string()
  .trim()
  .regex(/^\d{1,24}(\.\d{1,18})?$/, 'must be a positive decimal amount in major units');

/**
 * Body of `POST /v1/provider-quotes`.
 *
 * Strict: keys, wallets, beneficiary details and an `execute` flag are rejected rather than ignored.
 */
export const createProviderQuoteSchema = z
  .object({
    providerId: z.string().trim().min(1).max(128),
    sourceAsset: z.string().trim().min(2).max(16),
    targetAsset: z.string().trim().min(2).max(16),
    amount: assetAmount,
  })
  .strict()
  .refine((body) => body.sourceAsset !== body.targetAsset, {
    message: 'sourceAsset and targetAsset must differ',
    path: ['targetAsset'],
  });

export type CreateProviderQuoteBody = z.infer<typeof createProviderQuoteSchema>;

export function resolveProviderQuoteRequest(body: CreateProviderQuoteBody): {
  readonly providerId: string;
  readonly sourceAsset: string;
  readonly targetAsset: string;
  readonly amountMinorUnits: string;
} {
  const sourceAsset = assertAssetCode(body.sourceAsset);
  const targetAsset = assertAssetCode(body.targetAsset);
  return {
    providerId: body.providerId,
    sourceAsset,
    targetAsset,
    amountMinorUnits: toAssetMinorUnits(sourceAsset, body.amount),
  };
}

const routingWeight = z.string().regex(/^\d+(\.\d+)?$/, 'must be a non-negative decimal string');

/**
 * Body of `POST /v1/routes`.
 *
 * `organizationId` is taken from the principal, never the body. `execute`, keys and beneficiary
 * details are rejected by `.strict()`.
 */
export const createRouteSchema = z
  .object({
    sourceAsset: z.string().trim().min(2).max(16),
    destinationAsset: z.string().trim().min(2).max(16).optional(),
    targetAsset: z.string().trim().min(2).max(16).optional(),
    amount: assetAmount,
    preferences: z
      .object({
        weights: z
          .object({
            cost: routingWeight,
            speed: routingWeight,
            liquidity: routingWeight,
            reliability: routingWeight,
            settlementConfidence: routingWeight,
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((body) => (body.destinationAsset ?? body.targetAsset) !== undefined, {
    message: 'either destinationAsset or targetAsset is required',
    path: ['destinationAsset'],
  })
  .refine(
    (body) =>
      body.destinationAsset === undefined ||
      body.targetAsset === undefined ||
      body.destinationAsset === body.targetAsset,
    {
      message: 'destinationAsset and targetAsset must agree when both are supplied',
      path: ['targetAsset'],
    },
  )
  .refine((body) => body.sourceAsset !== (body.destinationAsset ?? body.targetAsset), {
    message: 'sourceAsset and destinationAsset must differ',
    path: ['destinationAsset'],
  });

export type CreateRouteBody = z.infer<typeof createRouteSchema>;

export function resolveRouteRequest(body: {
  readonly sourceAsset: string;
  readonly destinationAsset?: string;
  readonly targetAsset?: string;
  readonly amount: string;
}): {
  readonly sourceAsset: string;
  readonly destinationAsset: string;
  readonly amountMinorUnits: string;
} {
  const destination = body.destinationAsset ?? body.targetAsset;
  if (destination === undefined) {
    throw new ValidationError('A destination asset is required.', {});
  }
  const sourceAsset = assertAssetCode(body.sourceAsset);
  const destinationAsset = assertAssetCode(destination);
  return {
    sourceAsset,
    destinationAsset,
    amountMinorUnits: toAssetMinorUnits(sourceAsset, body.amount),
  };
}

/**
 * Body of `POST /v1/stablecoin-routes`.
 *
 * Same pair and amount as `/routes`, without scoring weights: this layer ranks by indicative cost.
 * `organizationId` is taken from the principal. `execute`, keys and beneficiary fields are rejected
 * by `.strict()`.
 */
export const createStablecoinRouteSchema = z
  .object({
    sourceAsset: z.string().trim().min(2).max(16),
    destinationAsset: z.string().trim().min(2).max(16).optional(),
    targetAsset: z.string().trim().min(2).max(16).optional(),
    amount: assetAmount,
  })
  .strict()
  .refine((body) => (body.destinationAsset ?? body.targetAsset) !== undefined, {
    message: 'either destinationAsset or targetAsset is required',
    path: ['destinationAsset'],
  })
  .refine(
    (body) =>
      body.destinationAsset === undefined ||
      body.targetAsset === undefined ||
      body.destinationAsset === body.targetAsset,
    {
      message: 'destinationAsset and targetAsset must agree when both are supplied',
      path: ['targetAsset'],
    },
  )
  .refine((body) => body.sourceAsset !== (body.destinationAsset ?? body.targetAsset), {
    message: 'sourceAsset and destinationAsset must differ',
    path: ['destinationAsset'],
  });

export type CreateStablecoinRouteBody = z.infer<typeof createStablecoinRouteSchema>;

const graphCostBps = z.string().regex(/^\d+(\.\d+)?$/, 'must be a non-negative decimal string');

/**
 * Body of `POST /v1/route-graph/paths`.
 *
 * `organizationId` is taken from the principal. `execute`, keys and beneficiary fields are
 * rejected by `.strict()`.
 */
export const createGraphPathSchema = z
  .object({
    sourceAsset: z.string().trim().min(2).max(16),
    destinationAsset: z.string().trim().min(2).max(16).optional(),
    targetAsset: z.string().trim().min(2).max(16).optional(),
    amount: assetAmount.optional(),
    constraints: z
      .object({
        maxHops: z.number().int().min(1).max(8).optional(),
        maxExpectedCostBps: graphCostBps.optional(),
        minLiquidity: assetAmount.optional(),
        supportedAssets: z.array(z.string().trim().min(2).max(16)).min(1).max(32).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((body) => (body.destinationAsset ?? body.targetAsset) !== undefined, {
    message: 'either destinationAsset or targetAsset is required',
    path: ['destinationAsset'],
  })
  .refine(
    (body) =>
      body.destinationAsset === undefined ||
      body.targetAsset === undefined ||
      body.destinationAsset === body.targetAsset,
    {
      message: 'destinationAsset and targetAsset must agree when both are supplied',
      path: ['targetAsset'],
    },
  )
  .refine((body) => body.sourceAsset !== (body.destinationAsset ?? body.targetAsset), {
    message: 'sourceAsset and destinationAsset must differ',
    path: ['destinationAsset'],
  });

export type CreateGraphPathBody = z.infer<typeof createGraphPathSchema>;

export function resolveGraphPathRequest(body: CreateGraphPathBody): {
  readonly sourceAsset: string;
  readonly destinationAsset: string;
  readonly amountMinorUnits: string | null;
  readonly maxHops: number | undefined;
  readonly maxExpectedCostBps: string | null;
  readonly minLiquidityMinorUnits: string | null;
  readonly supportedAssets: readonly string[] | null;
} {
  const destination = body.destinationAsset ?? body.targetAsset;
  if (destination === undefined) {
    throw new ValidationError('A destination asset is required.', {});
  }
  const sourceAsset = assertAssetCode(body.sourceAsset);
  const destinationAsset = assertAssetCode(destination);
  const amountMinorUnits =
    body.amount === undefined ? null : toAssetMinorUnits(sourceAsset, body.amount);
  const minLiquidityMinorUnits =
    body.constraints?.minLiquidity === undefined
      ? null
      : toAssetMinorUnits(sourceAsset, body.constraints.minLiquidity);
  return {
    sourceAsset,
    destinationAsset,
    amountMinorUnits,
    maxHops: body.constraints?.maxHops,
    maxExpectedCostBps: body.constraints?.maxExpectedCostBps ?? null,
    minLiquidityMinorUnits,
    supportedAssets: body.constraints?.supportedAssets ?? null,
  };
}
