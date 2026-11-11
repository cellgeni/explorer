import type {
  TranscriptAggregateBin,
  TranscriptCapabilities,
} from '../../data/transcriptOverlay'

export function transcriptAggregateRenderedLabel(
  bins: readonly TranscriptAggregateBin[],
): string {
  return `${bins.length.toLocaleString()} squares`
}

// "SNAP25", "SNAP25, AQP4 and GAD1" or "8 selected genes".
export function transcriptGenesLabel(featureNames: readonly string[]): string {
  if (featureNames.length > 3) {
    return `${featureNames.length.toLocaleString()} selected genes`
  }

  if (featureNames.length <= 1) {
    return featureNames[0] ?? ''
  }

  return `${featureNames.slice(0, -1).join(', ')} and ${featureNames.at(-1) ?? ''}`
}

export function transcriptCapabilityLabel(capabilities: TranscriptCapabilities): string {
  if (capabilities.geneRanges !== undefined) {
    if (capabilities.nativeZarr && capabilities.geneRanges) {
      return 'Per-gene LOD + exact'
    }

    if (capabilities.nativeZarr) {
      return 'Per-gene LOD'
    }

    return capabilities.geneRanges ? 'Per-gene exact' : 'No transcripts'
  }

  if (capabilities.nativeZarr && capabilities.rawParquet) {
    return 'Native LOD + exact'
  }

  if (capabilities.nativeZarr) {
    return 'Native LOD'
  }

  if (capabilities.rawParquet) {
    return 'Exact only'
  }

  return 'No transcripts'
}
