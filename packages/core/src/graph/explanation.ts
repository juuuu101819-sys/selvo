import { formatDecimal } from '../money/index.js';
import { isVenueNode, type GraphPath, type GraphRejection } from './types.js';

export function explainGraphPath(path: GraphPath): string {
  const hopWord = path.hops === 1 ? 'One-hop' : `${String(path.hops)}-hop`;
  const venues = path.nodes.filter(isVenueNode).map((node) => node.label);
  const via = venues.length === 0 ? '' : ` via ${joinAnd(venues)}`;
  return (
    `${hopWord} path ${path.assets.join(' → ')}${via}. ` +
    `Indicative cost ${formatDecimal(path.totalCostBps)} bps. ` +
    'Not executable — Meridian does not submit a conversion, swap or payout.'
  );
}

export function explainPathDiscovery(
  sourceAsset: string,
  destinationAsset: string,
  paths: readonly GraphPath[],
  rejections: readonly GraphRejection[],
): string {
  if (paths.length === 0) {
    const reasons = uniqueReasons(rejections);
    const reasonText =
      reasons.length === 0
        ? 'No conversion edges connect this corridor under the given constraints.'
        : `Search pruned every candidate (${reasons.join(', ')}).`;
    return `No path from ${sourceAsset} to ${destinationAsset}. ${reasonText}`;
  }

  const hops = [...new Set(paths.map((path) => path.hops))].sort((left, right) => left - right);
  const hopList = hops.map((count) => `${String(count)}-hop`).join(', ');
  const recommended = paths[0];
  return (
    `Discovered ${String(paths.length)} path${paths.length === 1 ? '' : 's'} ` +
    `${sourceAsset} → ${destinationAsset} (${hopList}). ` +
    `Recommended: ${recommended?.explanation ?? ''}`
  );
}

function joinAnd(parts: readonly string[]): string {
  const first = parts[0];
  const second = parts[1];
  if (first === undefined) {
    return '';
  }
  if (parts.length === 1 || second === undefined) {
    return first;
  }
  if (parts.length === 2) {
    return `${first} and ${second}`;
  }
  const last = parts[parts.length - 1];
  if (last === undefined) {
    return first;
  }
  return `${parts.slice(0, -1).join(', ')} and ${last}`;
}

function uniqueReasons(rejections: readonly GraphRejection[]): readonly string[] {
  return [...new Set(rejections.map((rejection) => rejection.reason))].sort();
}
