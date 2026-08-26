import { SUPPORTED_CURRENCIES, PROVIDER_LICENSING, RAIL_TYPES } from '@meridian/core';
import { z } from 'zod';

/**
 * Schemas for the external pricing datasets.
 *
 * The sandbox rails are priced from these files, never from constants in code (rule 8). Validating
 * them at load time means a malformed dataset fails at startup with a precise path, rather than
 * producing a plausible-looking but wrong quote at request time.
 */

const decimalString = z.string().regex(/^\d+(\.\d+)?$/, 'must be a non-negative decimal string');

const currencyCode = z.enum(SUPPORTED_CURRENCIES as [string, ...string[]]);

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:MM');

export const referenceRatesSchema = z.object({
  version: z.string().min(1),
  asOf: z.string().datetime(),
  source: z.string().min(1),
  disclaimer: z.string().min(1),
  baseCurrency: currencyCode,
  /** Units of each currency per one unit of `baseCurrency`. */
  unitsPerBase: z.record(currencyCode, decimalString),
});

export type ReferenceRatesData = z.infer<typeof referenceRatesSchema>;

/** `"*"` matches everything; a group name or explicit list narrows it. */
const currencyMatcher = z.union([
  z.literal('*'),
  z.object({ group: z.string().min(1) }),
  z.object({ currencies: z.array(currencyCode).min(1) }),
]);

export type CurrencyMatcher = z.infer<typeof currencyMatcher>;

const tier = z.object({
  /** Inclusive upper bound in major units of `notionalCurrency`. `null` means "and above". */
  upToAmount: decimalString.nullable(),
  bps: decimalString,
});

const flatSpread = z.object({ kind: z.literal('flat'), bps: decimalString });

const tieredByNotional = z.object({
  kind: z.literal('tiered'),
  notionalCurrency: currencyCode,
  tiers: z.array(tier).min(1),
});

const spread = z.discriminatedUnion('kind', [flatSpread, tieredByNotional]);

const slippage = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  tieredByNotional,
]);

/**
 * Fees are authored in USD because wholesale pricing books are. The adapter re-denominates them
 * into the corridor's currencies before handing the quote to the engine, so the engine only ever
 * sees fees it can value.
 */
const feeEntry = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('fixed'),
    code: z.string().min(1),
    label: z.string().min(1),
    side: z.enum(['source', 'destination']),
    amountUsd: decimalString,
  }),
  z.object({
    kind: z.literal('proportional'),
    code: z.string().min(1),
    label: z.string().min(1),
    side: z.enum(['source', 'destination']),
    rateBps: decimalString,
    minAmountUsd: decimalString.optional(),
    maxAmountUsd: decimalString.optional(),
  }),
]);

export type FeeEntry = z.infer<typeof feeEntry>;

const settlement = z.object({
  p50Seconds: z.number().int().nonnegative(),
  p95Seconds: z.number().int().nonnegative(),
  businessDaysOnly: z.boolean(),
  cutoffUtc: timeOfDay.nullable(),
  notes: z.string().nullable(),
});

const pricingProfile = z.object({
  label: z.string().min(1),
  match: z.object({ source: currencyMatcher, target: currencyMatcher }),
  spread,
  fees: z.array(feeEntry),
  settlement,
  slippage,
});

export type PricingProfile = z.infer<typeof pricingProfile>;

const providerProfile = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  rail: z.enum(RAIL_TYPES),
  licensing: z.enum(PROVIDER_LICENSING),
  jurisdictions: z.array(z.string().min(1)).min(1),
  description: z.string().min(1),
  reliabilityScore: decimalString,
  quoteTtlSeconds: z.number().int().positive(),
  intermediaryAsset: z.string().min(1).nullable(),
  corridors: z.object({ source: currencyMatcher, target: currencyMatcher }),
  notionalLimitsUsd: z.object({ min: decimalString, max: decimalString }),
  profiles: z.array(pricingProfile).min(1),
});

export type SandboxProviderProfile = z.infer<typeof providerProfile>;

export const sandboxPricingSchema = z
  .object({
    version: z.string().min(1),
    generatedAt: z.string().datetime(),
    disclaimer: z.string().min(1),
    currencyGroups: z.record(z.string(), z.array(currencyCode).min(1)),
    providers: z.array(providerProfile).min(1),
  })
  .superRefine((data, ctx) => {
    const groups = new Set(Object.keys(data.currencyGroups));

    const checkMatcher = (matcher: CurrencyMatcher, path: (string | number)[]): void => {
      if (typeof matcher !== 'string' && 'group' in matcher && !groups.has(matcher.group)) {
        ctx.addIssue({
          code: 'custom',
          path,
          message: `Unknown currency group "${matcher.group}".`,
        });
      }
    };

    const seen = new Set<string>();
    data.providers.forEach((provider, providerIndex) => {
      if (seen.has(provider.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['providers', providerIndex, 'id'],
          message: `Duplicate provider id "${provider.id}".`,
        });
      }
      seen.add(provider.id);

      checkMatcher(provider.corridors.source, ['providers', providerIndex, 'corridors', 'source']);
      checkMatcher(provider.corridors.target, ['providers', providerIndex, 'corridors', 'target']);

      provider.profiles.forEach((profile, profileIndex) => {
        const base = ['providers', providerIndex, 'profiles', profileIndex];
        checkMatcher(profile.match.source, [...base, 'match', 'source']);
        checkMatcher(profile.match.target, [...base, 'match', 'target']);

        if (profile.settlement.p95Seconds < profile.settlement.p50Seconds) {
          ctx.addIssue({
            code: 'custom',
            path: [...base, 'settlement', 'p95Seconds'],
            message: 'p95Seconds must not be below p50Seconds.',
          });
        }

        assertAscendingTiers(profile.spread, [...base, 'spread'], ctx);
        assertAscendingTiers(profile.slippage, [...base, 'slippage'], ctx);
      });

      const lastProfile = provider.profiles.at(-1);
      if (
        lastProfile !== undefined &&
        (lastProfile.match.source !== '*' || lastProfile.match.target !== '*')
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['providers', providerIndex, 'profiles'],
          message:
            'The final pricing profile must match every corridor, so a supported corridor always ' +
            'resolves to a price.',
        });
      }
    });
  });

export type SandboxPricingData = z.infer<typeof sandboxPricingSchema>;

function assertAscendingTiers(
  value: z.infer<typeof spread> | z.infer<typeof slippage>,
  path: (string | number)[],
  ctx: z.RefinementCtx,
): void {
  if (value.kind !== 'tiered') {
    return;
  }
  const last = value.tiers.at(-1);
  if (last?.upToAmount !== null) {
    ctx.addIssue({
      code: 'custom',
      path: [...path, 'tiers'],
      message: 'The final tier must be unbounded (`upToAmount: null`).',
    });
  }
  for (let index = 1; index < value.tiers.length; index += 1) {
    const previous = value.tiers[index - 1]?.upToAmount;
    const current = value.tiers[index]?.upToAmount;
    if (previous === null) {
      ctx.addIssue({
        code: 'custom',
        path: [...path, 'tiers', index],
        message: 'Only the final tier may be unbounded.',
      });
      return;
    }
    if (current !== null && previous !== undefined && Number(current) <= Number(previous)) {
      ctx.addIssue({
        code: 'custom',
        path: [...path, 'tiers', index],
        message: 'Tiers must be sorted ascending by threshold.',
      });
    }
  }
}
