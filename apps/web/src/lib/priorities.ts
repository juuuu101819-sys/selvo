export type PriorityPresetId = 'balanced' | 'cost' | 'speed' | 'reliability';

export interface PriorityPreset {
  readonly id: PriorityPresetId;
  readonly label: string;
  readonly description: string;
  readonly weights: {
    readonly cost: string;
    readonly speed: string;
    readonly reliability: string;
  };
}

/**
 * Scoring presets.
 *
 * The API accepts arbitrary weights, but a treasury team thinks in intents, not coefficients — so
 * the UI offers the intents and sends the weights. Each set sums to exactly 1, which the engine
 * requires so scores stay comparable between requests.
 */
export const PRIORITY_PRESETS: readonly PriorityPreset[] = [
  {
    id: 'balanced',
    label: 'Balanced',
    description: 'Weights cost most heavily, then settlement speed, then provider reliability.',
    weights: { cost: '0.6', speed: '0.3', reliability: '0.1' },
  },
  {
    id: 'cost',
    label: 'Lowest cost',
    description: 'Ranks purely on all-in cost against the mid-market benchmark.',
    weights: { cost: '1', speed: '0', reliability: '0' },
  },
  {
    id: 'speed',
    label: 'Fastest settlement',
    description: 'Prioritises settlement time, accepting a higher cost to move sooner.',
    weights: { cost: '0.2', speed: '0.8', reliability: '0' },
  },
  {
    id: 'reliability',
    label: 'Most reliable',
    description: 'Favours providers with the strongest historical settlement record.',
    weights: { cost: '0.3', speed: '0.2', reliability: '0.5' },
  },
];

export function weightsFor(id: PriorityPresetId): PriorityPreset['weights'] {
  const preset = PRIORITY_PRESETS.find((candidate) => candidate.id === id);
  return preset?.weights ?? { cost: '0.6', speed: '0.3', reliability: '0.1' };
}
