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

// The square's count, labelled: a coarse Xenium grid level counts a sample of
// the transcripts, so its count is marked as sampled, with the share of the
// slide's transcripts the level keeps. The card names the level.
export function transcriptAggregateCountRows(
  aggregate: TranscriptAggregateDatum,
): readonly { readonly label: string; readonly value: string }[] {
  const count = aggregate.count.toLocaleString()

  if (aggregate.sampledShare === undefined) {
    return [{ label: 'Count', value: count }]
  }

  return [
    { label: 'Sampled count', value: count },
    { label: 'Sample', value: `${formatShare(aggregate.sampledShare)} of transcripts` },
  ]
}

function formatShare(share: number): string {
  const percent = share * 100

  return percent >= 10
    ? `${Math.round(percent).toLocaleString()}%`
    : `${Number(percent.toPrecision(2)).toLocaleString()}%`
}
