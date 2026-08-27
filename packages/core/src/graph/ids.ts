export function assetNodeId(asset: string): string {
  return `asset:${asset}`;
}

export function venueNodeId(providerId: string): string {
  return `venue:${providerId}`;
}

export function conversionEdgeId(fromAsset: string, providerId: string, toAsset: string): string {
  return `edge:${fromAsset}:${providerId}:${toAsset}`;
}

export function graphPathId(edgeIds: readonly string[]): string {
  return `path:${edgeIds.join('|')}`;
}
