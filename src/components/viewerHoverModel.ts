import type { TranscriptAggregateDatum } from '../rendering/deckLayers'

// What a density square counts: "SNAP25 transcripts" for one selected gene,
// "Selected-gene transcripts" for several, otherwise all transcripts.
export function transcriptAggregateTitle(aggregate: TranscriptAggregateDatum): string {
  if (aggregate.featureName !== undefined) {
    return aggregate.featureName
  }

  if (aggregate.selectedGeneCount === undefined) {
    return aggregate.source === 'cell-summary'
      ? 'Transcripts in cells'
      : 'All transcripts'
  }

  const features = aggregate.topFeatures ?? []

  return features.length === 1 && features[0] !== undefined
    ? `${features[0].featureName} transcripts`
    : 'Selected-gene transcripts'
}
