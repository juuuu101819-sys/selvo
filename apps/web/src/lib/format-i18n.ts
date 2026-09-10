import { settlementParts, type SettlementUnit } from './format';

/** Locale-aware settlement label. Amounts and currency codes stay out of this helper. */
export function formatSettlementMessage(
  t: (key: SettlementUnit, values: { count: number }) => string,
  seconds: number,
  businessDaysOnly: boolean,
): string {
  const { count, unit } = settlementParts(seconds, businessDaysOnly);
  return t(unit, { count });
}
