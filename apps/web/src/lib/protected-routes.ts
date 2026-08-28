/**
 * Dashboard routes that require a session cookie.
 *
 * Middleware matches `/dashboard` and `/dashboard/:path*`. This list is the concrete pages the
 * gate must cover; the session-gate tests enumerate it so a new page cannot ship ungated.
 */
export const PROTECTED_DASHBOARD_PATHS = [
  '/dashboard',
  '/dashboard/quotes',
  '/dashboard/transactions',
  '/dashboard/providers',
  '/dashboard/revenue',
  '/dashboard/invoices',
  '/dashboard/invoices/agt_example',
  '/dashboard/onboarding',
  '/dashboard/settings',
  '/dashboard/agents',
  '/dashboard/agents/agt_example',
  '/dashboard/agents/agt_example/payments',
  '/dashboard/agents/agt_example/policies',
] as const;

export type ProtectedDashboardPath = (typeof PROTECTED_DASHBOARD_PATHS)[number];
