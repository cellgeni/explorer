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
