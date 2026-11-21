import type { CellId } from './cellid'
import type { BBox, DataPoint } from './coords'

export const TRANSCRIPT_EXACT_RENDER_LIMIT = 100_000
export const MIN_TRANSCRIPT_EXACT_RENDER_LIMIT = 1
export const MAX_TRANSCRIPT_EXACT_RENDER_LIMIT = 1_000_000
export const TRANSCRIPT_GROUP_LIMIT = 18

export type TranscriptDetailMode = 'auto' | 'density' | 'exact'
export type TranscriptFeatureFilterMode = 'all' | 'selected'
export type TranscriptCellAssignment = 'known' | 'unassigned' | 'unavailable'

// A transcripts.zarr.zip grid level's tiles and how many transcripts each holds.
export interface TranscriptGridLevelMetadata {
  readonly level: number
  readonly tileSizeMicrometers: number
  readonly gridKeys: readonly string[]
  readonly transcriptCounts: readonly number[]
  // The level's share of the transcripts level 0 counts, when it is below 1:
  // the coarser levels count a sample.
  readonly sampledShare?: number
}

export interface TranscriptCapabilities {
  readonly rawParquet: boolean
  readonly nativeZarr: boolean
  readonly rawParquetError?: string
  readonly nativeZarrError?: string
  // The level-0 transcript counts per tile of transcripts.zarr.zip, for the
  // visible transcript estimate. Without them it sums the cells' counts.
  readonly nativeZarrGridCounts?: TranscriptGridLevelMetadata
  readonly nativeZarrGridCountsError?: string
  // Set for outputs read per selected gene (Atera): `nativeZarr` is per-gene
  // density, and `geneRanges` is exact points from each gene's rows.
  readonly geneRanges?: boolean
  readonly geneRangesError?: string
}

export interface TranscriptPoint {
  readonly id: string
  readonly transcriptId?: string
  readonly cellId: CellId | null
  readonly cellAssignment?: TranscriptCellAssignment
  readonly featureName: string
  readonly fovName: string | null
  readonly position: DataPoint
  readonly zLocation?: number
  readonly qv: number
  readonly overlapsNucleus?: boolean
  readonly isGene?: boolean
  readonly nucleusDistance?: number
}

export interface TranscriptGroupSummary {
  readonly featureName: string
  readonly fovName: string | null
  readonly count: number
  readonly meanQv?: number
}

export interface TranscriptAggregateBin {
  readonly id: string
  readonly source?: 'cell-summary' | 'native-zarr'
  readonly glyphType?: 'density'
  readonly level: number
  readonly binX: number
  readonly binY: number
  readonly position: DataPoint
  readonly radiusMicrometers: number
  readonly binSizeMicrometers?: number
  readonly count: number
  // Below 1 when `count` is of a sample: a coarse Xenium grid level keeps
  // this share of the transcripts.
  readonly sampledShare?: number
  readonly binTotalCount?: number
  readonly selectedGeneCount?: number
  readonly omittedFeatureCount?: number
  readonly omittedTranscriptCount?: number
  readonly topFeatures?: readonly TranscriptAggregateFeatureSummary[]
  // Every selected gene in the square, most transcripts first, for gene
  // markers. Squares counting all transcripts have none.
  readonly featureGroups?: readonly TranscriptAggregateFeatureGroup[]
  readonly featureName?: string
  readonly fovName?: string
  readonly meanQv?: number
}

export interface TranscriptAggregateFeatureSummary {
  readonly featureName: string
  readonly count: number
}

// One gene's transcripts in a density square, at their count-weighted centre:
// the transcripts' own positions when binned from points, the native bins'
// centres otherwise.
export interface TranscriptAggregateFeatureGroup {
  readonly featureName: string
  readonly count: number
  readonly position: DataPoint
}

export interface TranscriptLodLevel {
  readonly level: number
  readonly gridSizeMicrometers: number
  readonly gridKeys: readonly string[]
  readonly transcriptCounts: readonly number[]
}

export interface TranscriptViewportEstimate {
  readonly source: 'cell-summary' | 'native-zarr' | 'raw-count'
  readonly count: number
}

export type TranscriptLayerDataState =
  | {
      readonly kind: 'exact'
      readonly points: readonly TranscriptPoint[]
      readonly groups: readonly TranscriptGroupSummary[]
    }
  | {
      readonly kind: 'aggregate'
      readonly bins: readonly TranscriptAggregateBin[]
      readonly level: TranscriptLodLevel
    }

export interface TranscriptViewportResult {
  readonly points: readonly TranscriptPoint[]
  readonly groups: readonly TranscriptGroupSummary[]
  readonly hitPointLimit: boolean
}

export interface TranscriptAggregateResult {
  readonly bins: readonly TranscriptAggregateBin[]
  readonly level: TranscriptLodLevel
  readonly source: 'native-zarr'
  // The genes the bins count; empty when they count all transcripts.
  readonly selectedFeatureNames: readonly string[]
  readonly scaleMax?: number
  // Selected-gene transcripts inside the box.
  readonly visibleTranscriptCount?: number
  // File the bins came from, when it is not transcripts.zarr.zip.
  readonly sourceFile?: string
  // Set, with no bins, when the view needs more density/gene data chunks
  // than one view may read (15.1-J).
  readonly overBudget?: {
    readonly chunkCount: number
    readonly chunkLimit: number
  }
  // The QV the bins count from, when they filter by QV (Atera).
  readonly minQv?: number
  // Set when the bins count from a lower QV than asked, because the asked
  // one needs more transcript rows than one view may read (Atera).
  readonly qvOverBudget?: {
    readonly minQv: number
    readonly rowCount: number
    readonly rowLimit: number
  }
}

export type TranscriptLodPlan =
  | {
      readonly kind: 'exact'
      readonly mode: 'exact'
      readonly visibleTranscriptEstimate: number
      readonly exactLimit: number
    }
  | {
      readonly kind: 'native-zarr'
      readonly mode: 'density'
      readonly visibleTranscriptEstimate: number
      readonly exactLimit: number
      readonly message: string
    }
  | {
      readonly kind: 'waiting'
      readonly visibleTranscriptEstimate: number
      readonly exactLimit: number
      readonly message: string
    }
  | {
      readonly kind: 'unavailable'
      readonly visibleTranscriptEstimate: number
      readonly exactLimit: number
      readonly message: string
    }

export interface TranscriptLodPlanningInput {
  readonly viewState: { readonly zoom: number }
}

export interface TranscriptLodPlanningOptions {
  readonly detailMode: TranscriptDetailMode
  readonly visibleTranscriptEstimate: number
  readonly exactLimit?: number
  readonly hasRawParquet: boolean
  readonly hasNativeZarr: boolean
  readonly hasSelectedFeatureFilter?: boolean
  // Defaults to either source; per-gene outputs read exact points elsewhere.
  readonly hasExactSource?: boolean
}

export function planTranscriptLod(
  _input: TranscriptLodPlanningInput,
  options: TranscriptLodPlanningOptions,
): TranscriptLodPlan {
  const exactLimit = normalizeTranscriptExactPointLimit(options.exactLimit)
  const visibleTranscriptEstimate = Math.max(
    0,
    Math.floor(options.visibleTranscriptEstimate),
  )

  if (!options.hasRawParquet && !options.hasNativeZarr) {
    return {
      kind: 'unavailable',
      visibleTranscriptEstimate,
      exactLimit,
      message: 'No range-readable transcript output was detected for this dataset.',
    }
  }

  if (options.detailMode === 'density') {
    return options.hasNativeZarr
      ? {
          kind: 'native-zarr',
          mode: 'density',
          visibleTranscriptEstimate,
          exactLimit,
          message:
            'Use the official Xenium transcripts.zarr.zip density/grid pyramid for this view.',
        }
      : {
          kind: 'unavailable',
          visibleTranscriptEstimate,
          exactLimit,
          message: 'Density mode needs the official transcripts.zarr.zip LOD output.',
        }
  }

  const hasExactSource =
    options.hasExactSource ?? (options.hasRawParquet || options.hasNativeZarr)
  const hasSelectedFeatureFilter = options.hasSelectedFeatureFilter !== false

  if (
    hasExactSource &&
    hasSelectedFeatureFilter &&
    visibleTranscriptEstimate <= exactLimit
  ) {
    return {
      kind: 'exact',
      mode: 'exact',
      visibleTranscriptEstimate,
      exactLimit,
    }
  }

  if (options.detailMode === 'auto' && options.hasNativeZarr) {
    return {
      kind: 'native-zarr',
      mode: 'density',
      visibleTranscriptEstimate,
      exactLimit,
      message:
        'Using the official Xenium transcript density/grid LOD is the right overview path.',
    }
  }

  if (!hasSelectedFeatureFilter) {
    return {
      kind: 'waiting',
      visibleTranscriptEstimate,
      exactLimit,
      message: 'Select genes or switch the transcript feature filter to All.',
    }
  }

  if (!hasExactSource) {
    return {
      kind: 'unavailable',
      visibleTranscriptEstimate,
      exactLimit,
      message:
        'Exact transcript rendering needs range-readable transcripts.zarr.zip or transcripts.parquet.',
    }
  }

  return {
    kind: 'waiting',
    visibleTranscriptEstimate,
    exactLimit,
    message:
      visibleTranscriptEstimate > exactLimit
        ? `Zoom or filter below ${exactLimit.toLocaleString()} visible transcripts for exact rendering.`
        : 'Zoom closer for exact transcript rendering.',
  }
}

export function normalizeTranscriptExactPointLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return TRANSCRIPT_EXACT_RENDER_LIMIT
  }

  return Math.max(
    MIN_TRANSCRIPT_EXACT_RENDER_LIMIT,
    Math.min(MAX_TRANSCRIPT_EXACT_RENDER_LIMIT, Math.round(value)),
  )
}

export function transcriptViewportRequestKey(
  baseUrl: string,
  bbox: BBox,
  options: {
    readonly minQv: number
    readonly geneOnly: boolean
    readonly featureNames: readonly string[]
    readonly pointLimit: number
  },
): string {
  return [
    baseUrl,
    bbox.minX.toFixed(1),
    bbox.minY.toFixed(1),
    bbox.maxX.toFixed(1),
    bbox.maxY.toFixed(1),
    options.minQv,
    options.geneOnly ? 'gene' : 'all',
    options.pointLimit,
    [...options.featureNames].sort((a, b) => a.localeCompare(b)).join(','),
  ].join('|')
}

export function transcriptAggregateRequestKey(
  baseUrl: string,
  bbox: BBox,
  options: {
    readonly mode: 'density'
    readonly featureNames: readonly string[]
    readonly maxBins: number
    readonly minQv?: number
  },
): string {
  return [
    baseUrl,
    'aggregate',
    bbox.minX.toFixed(1),
    bbox.minY.toFixed(1),
    bbox.maxX.toFixed(1),
    bbox.maxY.toFixed(1),
    options.mode,
    options.maxBins,
    [...options.featureNames].sort((a, b) => a.localeCompare(b)).join(','),
    ...(options.minQv === undefined ? [] : [`qv${options.minQv}`]),
  ].join('|')
}
