import type { MandateStore, StoredMandate, X402Challenge } from '@meridian/core';

export class InMemoryMandateStore implements MandateStore {
  private readonly byId = new Map<string, StoredMandate>();
  private readonly challenges = new Map<string, X402Challenge>();

  save(row: StoredMandate): Promise<StoredMandate> {
    const stored = structuredClone(row);
    this.byId.set(row.id, stored);
    return Promise.resolve(structuredClone(stored));
  }

  findById(id: string, organizationId: string): Promise<StoredMandate | null> {
    const found = this.byId.get(id);
    if (found === undefined || found.organizationId !== organizationId) {
      return Promise.resolve(null);
    }
    return Promise.resolve(structuredClone(found));
  }

  listVerified(
    organizationId: string,
    agentId: string,
    nowIso: string,
  ): Promise<readonly StoredMandate[]> {
    const now = Date.parse(nowIso);
    const rows = [...this.byId.values()].filter(
      (row) =>
        row.organizationId === organizationId &&
        row.agentId === agentId &&
        row.status === 'verified' &&
        Date.parse(row.expiresAt) > now,
    );
    return Promise.resolve(rows.map((row) => structuredClone(row)));
  }

  revoke(input: {
    readonly id: string;
    readonly organizationId: string;
    readonly actor: string;
    readonly nowIso: string;
  }): Promise<StoredMandate | null> {
    const found = this.byId.get(input.id);
    if (found === undefined || found.organizationId !== input.organizationId) {
      return Promise.resolve(null);
    }
    const revoked: StoredMandate = {
      ...found,
      status: 'revoked',
      revokedAt: found.revokedAt ?? input.nowIso,
      revokedByActor: found.revokedByActor ?? input.actor,
      updatedAt: input.nowIso,
    };
    this.byId.set(input.id, revoked);
    return Promise.resolve(structuredClone(revoked));
  }

  saveChallenge(challenge: X402Challenge): Promise<X402Challenge> {
    const stored = structuredClone(challenge);
    this.challenges.set(challenge.id, stored);
    return Promise.resolve(structuredClone(stored));
  }

  findChallenge(id: string, organizationId: string): Promise<X402Challenge | null> {
    const found = this.challenges.get(id);
    if (found === undefined || found.organizationId !== organizationId) {
      return Promise.resolve(null);
    }
    return Promise.resolve(structuredClone(found));
  }

  deleteChallenge(id: string, organizationId: string): Promise<void> {
    const found = this.challenges.get(id);
    if (found !== undefined && found.organizationId === organizationId) {
      this.challenges.delete(id);
    }
    return Promise.resolve();
  }
}
