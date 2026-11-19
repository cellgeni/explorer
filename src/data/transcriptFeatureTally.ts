import { micrometers } from './coords'
import type {
  TranscriptAggregateFeatureGroup,
  TranscriptAggregateFeatureSummary,
} from './transcriptOverlay'

// One gene's transcripts in a density square: how many, and the sums of
// their positions, so its gene marker can sit at their count-weighted centre.
export interface TranscriptFeatureTally {
  count: number
  sumX: number
  sumY: number
}

// Adds `count` transcripts at (x, y), a transcript or the centre of a native
// bin, to the gene's tally.
export function addTranscriptFeatureTally(
  tallies: Map<string, TranscriptFeatureTally>,
  featureName: string,
  count: number,
  x: number,
  y: number,
): void {
  const tally = tallies.get(featureName)

  if (tally === undefined) {
    tallies.set(featureName, { count, sumX: count * x, sumY: count * y })
    return
  }

  tally.count += count
  tally.sumX += count * x
  tally.sumY += count * y
}

// Every gene in the square, most transcripts first.
export function transcriptFeatureGroups(
  tallies: ReadonlyMap<string, TranscriptFeatureTally>,
): readonly TranscriptAggregateFeatureGroup[] {
  return [...tallies.entries()]
    .filter(([, tally]) => tally.count > 0)
    .sort(
      ([nameA, tallyA], [nameB, tallyB]) =>
        tallyB.count - tallyA.count || nameA.localeCompare(nameB),
    )
    .map(([featureName, tally]) => ({
      featureName,
      count: tally.count,
      position: {
        x: micrometers(tally.sumX / tally.count),
        y: micrometers(tally.sumY / tally.count),
      },
    }))
}

// The genes with most transcripts in the square, for its tooltip.
export function topTranscriptFeatures(
  groups: readonly TranscriptAggregateFeatureGroup[],
  limit: number,
): readonly TranscriptAggregateFeatureSummary[] {
  return groups
    .slice(0, Math.max(0, Math.floor(limit)))
    .map(({ featureName, count }) => ({ featureName, count }))
}
