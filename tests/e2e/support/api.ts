import type { APIResponse } from '@playwright/test';

/**
 * Typed access to a JSON response body.
 *
 * Playwright's `response.json()` returns `any`, which would quietly disable type checking across the
 * whole end-to-end suite — including on the money fields these tests exist to protect. Parsing
 * through a declared shape keeps the specs as strictly typed as the rest of the codebase.
 */
export async function jsonBody<TBody>(response: APIResponse): Promise<TBody> {
  return (await response.json()) as TBody;
}

export interface MoneyBody {
  readonly minorUnits: string;
  readonly currency: string;
  readonly decimal: string;
  readonly exponent: number;
}

export interface HealthBody {
  readonly status: string;
  readonly service: string;
  readonly version: string;
}

export interface ReadyBody {
  readonly status: string;
  readonly service: string;
  readonly checks: { readonly persistence: string };
}

export interface ComparisonBody {
  readonly data: {
    readonly comparisonId: string;
    readonly fingerprint: string;
    readonly recommendedRouteId: string | null;
    readonly routes: readonly {
      readonly routeId: string;
      readonly deliveredAmount: MoneyBody;
      readonly totalCost: MoneyBody;
    }[];
  };
  readonly meta: { readonly mode: string; readonly disclaimer: string };
}

export interface ReplayBody {
  readonly data: {
    readonly reproducible: boolean;
    readonly originalFingerprint: string;
    readonly replayedFingerprint: string;
  };
}

export interface ErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details: Record<string, unknown>;
    readonly requestId: string;
  };
}
