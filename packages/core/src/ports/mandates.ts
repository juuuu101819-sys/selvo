import type { JsonObject } from '../domain/json.js';
import type { StoredMandate, X402Challenge } from '../mandates/types.js';

export interface MandateStore {
  save(row: StoredMandate): Promise<StoredMandate>;
  findById(id: string, organizationId: string): Promise<StoredMandate | null>;
  listVerified(organizationId: string, agentId: string, nowIso: string): Promise<readonly StoredMandate[]>;
  revoke(input: {
    readonly id: string;
    readonly organizationId: string;
    readonly actor: string;
    readonly nowIso: string;
  }): Promise<StoredMandate | null>;
  saveChallenge(challenge: X402Challenge): Promise<X402Challenge>;
  findChallenge(id: string, organizationId: string): Promise<X402Challenge | null>;
  deleteChallenge(id: string, organizationId: string): Promise<void>;
}

export type { JsonObject };
