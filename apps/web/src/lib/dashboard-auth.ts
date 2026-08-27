import { fetchMe } from '@/lib/api/client';
import type { ApiFailure, AuthMeDto } from '@/lib/api/types';
import { readSessionToken } from '@/lib/session';

export type DashboardSession =
  | { readonly ok: true; readonly token: string; readonly me: AuthMeDto }
  | { readonly ok: false; readonly failure: ApiFailure };

export async function loadDashboardSession(): Promise<DashboardSession> {
  const token = await readSessionToken();
  if (token === null) {
    return {
      ok: false,
      failure: {
        code: 'UNAUTHENTICATED',
        message: 'Sign in to open the organization dashboard.',
        details: {},
        requestId: null,
      },
    };
  }
  const me = await fetchMe(token);
  if (!me.ok) {
    return me;
  }
  return { ok: true, token, me: me.data };
}
