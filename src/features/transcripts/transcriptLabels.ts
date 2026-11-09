import type {
  TranscriptAggregateBin,
  TranscriptCapabilities,
} from '../../data/transcriptOverlay'

export function transcriptAggregateRenderedLabel(
  bins: readonly TranscriptAggregateBin[],
): string {
  return `${bins.length.toLocaleString()} squares`
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
