'use client';

import { ArrowRightLeft, Loader2, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { amountPlaceholder } from '@/lib/format';
import type { CurrencyDto, RailDto } from '@/lib/api/types';
import { PRIORITY_PRESETS, type PriorityPresetId } from '@/lib/priorities';

export interface FormValue {
  readonly sourceCurrency: string;
  readonly targetCurrency: string;
  readonly amount: string;
  readonly rails: readonly string[];
  readonly priority: PriorityPresetId;
}

interface ComparisonFormProps {
  readonly currencies: readonly CurrencyDto[];
  readonly rails: readonly RailDto[];
  readonly value: FormValue;
  readonly isPending: boolean;
  readonly onChange: (value: FormValue) => void;
  readonly onSubmit: () => void;
}

export function ComparisonForm({
  currencies,
  rails,
  value,
  isPending,
  onChange,
  onSubmit,
}: ComparisonFormProps) {
  const t = useTranslations('comparison');
  const sourceExponent =
    currencies.find((currency) => currency.code === value.sourceCurrency)?.exponent ?? 2;
  const availableRails = rails.filter((rail) => rail.status === 'available');
  const amountHint =
    sourceExponent === 0
      ? t('amountHintWhole', { currency: value.sourceCurrency })
      : t('amountHintMinor', { count: sourceExponent, currency: value.sourceCurrency });

  const toggleRail = (rail: string): void => {
    const next = value.rails.includes(rail)
      ? value.rails.filter((item) => item !== rail)
      : [...value.rails, rail];
    onChange({ ...value, rails: next });
  };

  return (
    <form
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-[1fr_auto_1fr]">
        <div className="space-y-2">
          <Label htmlFor="amount">{t('youSend')}</Label>
          <div className="flex gap-2">
            <Input
              id="amount"
              name="amount"
              inputMode="decimal"
              autoComplete="off"
              placeholder={amountPlaceholder(sourceExponent)}
              value={value.amount}
              onChange={(event) => {
                // Keep the field to digits and a single separator; the API is the real validator.
                const cleaned = event.target.value
                  .replace(/[^\d.]/g, '')
                  .replace(/(\..*)\./g, '$1');
                onChange({ ...value, amount: cleaned });
              }}
              className="font-mono text-base"
              aria-describedby="amount-hint"
            />
            <CurrencySelect
              label={t('sourceCurrency')}
              currencies={currencies}
              value={value.sourceCurrency}
              onChange={(code) => onChange({ ...value, sourceCurrency: code })}
            />
          </div>
          <p id="amount-hint" className="text-muted-foreground text-xs">
            {amountHint}
          </p>
        </div>

        <div className="flex items-end justify-center pb-8 sm:pb-9">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t('swapCurrencies')}
            onClick={() =>
              onChange({
                ...value,
                sourceCurrency: value.targetCurrency,
                targetCurrency: value.sourceCurrency,
              })
            }
          >
            <ArrowRightLeft className="size-4" aria-hidden />
          </Button>
        </div>

        <div className="space-y-2">
          <Label htmlFor="target-currency">{t('beneficiaryReceives')}</Label>
          <CurrencySelect
            id="target-currency"
            label={t('targetCurrency')}
            currencies={currencies}
            value={value.targetCurrency}
            onChange={(code) => onChange({ ...value, targetCurrency: code })}
            className="w-full"
          />
          <p className="text-muted-foreground text-xs">{t('deliveredHint')}</p>
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t('optimiseFor')}</legend>
        <div className="flex flex-wrap gap-2">
          {PRIORITY_PRESETS.map((preset) => {
            const selected = preset.id === value.priority;
            return (
              <Button
                key={preset.id}
                type="button"
                size="sm"
                variant={selected ? 'default' : 'outline'}
                aria-pressed={selected}
                onClick={() => onChange({ ...value, priority: preset.id })}
              >
                {t(`priority.${preset.id}.label`)}
              </Button>
            );
          })}
        </div>
        <p className="text-muted-foreground text-xs">
          {t(`priority.${value.priority}.description`)}
        </p>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">
          {t('rails')}{' '}
          <span className="text-muted-foreground font-normal">
            {value.rails.length === 0 ? t('railsAll') : t('railsSelected', { count: value.rails.length })}
          </span>
        </legend>
        <div className="flex flex-wrap gap-2">
          {availableRails.map((rail) => {
            const selected = value.rails.includes(rail.type);
            return (
              <button
                key={rail.type}
                type="button"
                aria-pressed={selected}
                onClick={() => toggleRail(rail.type)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  selected
                    ? 'border-emerald-600 bg-emerald-600 text-white'
                    : 'border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground'
                }`}
              >
                {rail.label}
              </button>
            );
          })}
          {rails
            .filter((rail) => rail.status === 'planned')
            .map((rail) => (
              <Badge key={rail.type} variant="outline" className="text-muted-foreground text-xs">
                {t('plannedRail', { label: rail.label })}
              </Badge>
            ))}
        </div>
      </fieldset>

      <Button
        type="submit"
        disabled={isPending || value.amount === ''}
        className="w-full sm:w-auto"
      >
        {isPending ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {t('comparing')}
          </>
        ) : (
          <>
            <Search className="size-4" aria-hidden />
            {t('compare')}
          </>
        )}
      </Button>
    </form>
  );
}

function CurrencySelect({
  id,
  label,
  currencies,
  value,
  onChange,
  className,
}: {
  id?: string;
  label: string;
  currencies: readonly CurrencyDto[];
  value: string;
  onChange: (code: string) => void;
  className?: string;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        // Base UI allows clearing a select; the corridor always needs both legs, so a null is
        // treated as "no change" rather than an empty currency.
        if (next !== null) {
          onChange(next);
        }
      }}
    >
      <SelectTrigger id={id} aria-label={label} className={className ?? 'w-28 shrink-0'}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {currencies.map((currency) => (
          <SelectItem key={currency.code} value={currency.code}>
            <span className="font-mono">{currency.code}</span>
            <span className="text-muted-foreground ml-2 hidden sm:inline">{currency.name}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
