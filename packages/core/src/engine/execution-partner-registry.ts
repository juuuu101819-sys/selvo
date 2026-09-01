import { ConfigurationError } from '../errors/index.js';
import type {
  ExecutionPartner,
  ExecutionPartnerKind,
} from '../ports/execution-partner.js';
import { partnerSupportsRequest, type PartnerMatchRequest } from './partner-capability.js';

export interface ExecutionPartnerRegistryOptions {
  /**
   * When false (default), partners with `kind: 'live'` are excluded. No live adapters exist in
   * this repository; the flag is the architectural gate so a future adapter cannot register
   * accidentally.
   */
  readonly liveEnabled: boolean;
}

export interface ExecutionPartnerExclusion {
  readonly partnerId: string;
  readonly reason: string;
}

/**
 * Catalog of execution partners admitted for this process.
 *
 * Live partners are fail-closed behind `PARTNER_LIVE_ENABLED`. Sandbox mocks may quote and
 * simulate instruction dispatch; they never move Meridian-held funds (there are none).
 */
export class ExecutionPartnerRegistry {
  private readonly byId: ReadonlyMap<string, ExecutionPartner>;
  readonly liveEnabled: boolean;
  readonly exclusions: readonly ExecutionPartnerExclusion[];

  private constructor(
    partners: readonly ExecutionPartner[],
    liveEnabled: boolean,
    exclusions: readonly ExecutionPartnerExclusion[],
  ) {
    this.liveEnabled = liveEnabled;
    this.exclusions = exclusions;
    this.byId = new Map(partners.map((partner) => [partner.capabilities.partnerId, partner]));
  }

  static create(
    partners: readonly ExecutionPartner[],
    options: ExecutionPartnerRegistryOptions,
  ): ExecutionPartnerRegistry {
    const seen = new Set<string>();
    const admitted: ExecutionPartner[] = [];
    const exclusions: ExecutionPartnerExclusion[] = [];

    for (const partner of partners) {
      const id = partner.capabilities.partnerId;
      if (seen.has(id)) {
        throw new ConfigurationError(`Duplicate execution partner id "${id}".`, { partnerId: id });
      }
      seen.add(id);

      if (partner.kind === 'live' || partner.capabilities.live || partner.capabilities.kind === 'live') {
        if (!options.liveEnabled) {
          exclusions.push({
            partnerId: id,
            reason: 'live execution partners are disabled (PARTNER_LIVE_ENABLED=false)',
          });
          continue;
        }
        exclusions.push({
          partnerId: id,
          reason: 'live execution partners are not implemented',
        });
        continue;
      }
      if (partner.kind !== 'sandbox_mock') {
        const kindLabel: string =
          typeof partner.kind === 'string' ? partner.kind : 'unrecognized';
        exclusions.push({ partnerId: id, reason: `unknown execution partner kind "${kindLabel}"` });
        continue;
      }
      admitted.push(partner);
    }

    return new ExecutionPartnerRegistry(admitted, options.liveEnabled, exclusions);
  }

  all(): readonly ExecutionPartner[] {
    return [...this.byId.values()].sort((left, right) =>
      left.capabilities.partnerId.localeCompare(right.capabilities.partnerId, 'en'),
    );
  }

  get(partnerId: string): ExecutionPartner | null {
    return this.byId.get(partnerId) ?? null;
  }

  forQuotedProvider(quotedProviderId: string): readonly ExecutionPartner[] {
    return this.all().filter((partner) => partner.capabilities.quotedProviderId === quotedProviderId);
  }

  eligible(request: PartnerMatchRequest): readonly ExecutionPartner[] {
    return this.all().filter((partner) => partnerSupportsRequest(partner.capabilities, request));
  }

  admitsKind(kind: ExecutionPartnerKind): boolean {
    return this.all().some((partner) => partner.kind === kind);
  }
}
