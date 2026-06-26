import type { RoiDrawMode } from '../../components/ViewerCore'
import type { BBox } from '../../data/coords'
import type { RoiGeneStats } from '../../data/roiGeneStats'
import type { RoiSelection } from '../../data/roiSelection'
import type { DatasetCell, DatasetTranscript } from '../../datasets/xeniumDataset'

export const ROI_GENE_STATS_PREVIEW_CELL_LIMIT = 32
export const ROI_GENE_VIEWPORT_PREWARM_CELL_LIMIT = 5_000
export const ROI_GENE_VIEWPORT_PREWARM_DEBOUNCE_MS = 120

export interface RoiLoadErrorSummary {
  readonly title: string
}

export type RoiState<ErrorType extends RoiLoadErrorSummary = RoiLoadErrorSummary> =
  | { readonly status: 'idle' }
  | {
      readonly status: 'loading'
      readonly url: string
      readonly bbox: BBox
      readonly selection: RoiSelection
    }
  | {
      readonly status: 'ready'
      readonly url: string
      readonly bbox: BBox
      readonly selection: RoiSelection
      readonly cells: readonly DatasetCell[]
      readonly hitCellLimit: boolean
    }
  | {
      readonly status: 'error'
      readonly url: string
      readonly bbox: BBox
      readonly selection: RoiSelection
      readonly error: ErrorType
    }

export type RoiGeneStatsState<
  ErrorType extends RoiLoadErrorSummary = RoiLoadErrorSummary,
> =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly url: string; readonly cellCount: number }
  | {
      readonly status: 'ready'
      readonly url: string
      readonly stats: RoiGeneStats
    }
  | {
      readonly status: 'error'
      readonly url: string
      readonly error: ErrorType
    }

export type RoiGeneViewportWarmupState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly key: string }
  | { readonly status: 'ready'; readonly key: string }
  | { readonly status: 'error'; readonly key: string }

export type RoiTranscriptExportState<
  ErrorType extends RoiLoadErrorSummary = RoiLoadErrorSummary,
> =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly url: string }
  | {
      readonly status: 'error'
      readonly url: string
      readonly error: ErrorType
    }

export const IDLE_ROI_STATE: RoiState<never> = { status: 'idle' }
export const IDLE_ROI_GENE_STATS_STATE: RoiGeneStatsState<never> = {
  status: 'idle',
}
export const IDLE_ROI_GENE_VIEWPORT_WARMUP_STATE: RoiGeneViewportWarmupState = {
  status: 'idle',
}
export const IDLE_ROI_TRANSCRIPT_EXPORT_STATE: RoiTranscriptExportState<never> = {
  status: 'idle',
}

export interface RoiSummary {
  readonly cellCount: number
  readonly meanTranscriptCount: number
  readonly meanCellArea: number | undefined
}

export function roiLoading(
  url: string,
  bbox: BBox,
  selection: RoiSelection,
): RoiState<never> {
  return { status: 'loading', url, bbox, selection }
}

export function roiReady(
  url: string,
  bbox: BBox,
  selection: RoiSelection,
  cells: readonly DatasetCell[],
  hitCellLimit: boolean,
): RoiState<never> {
  return { status: 'ready', url, bbox, selection, cells, hitCellLimit }
}

export function roiFailed<ErrorType extends RoiLoadErrorSummary>(
  url: string,
  bbox: BBox,
  selection: RoiSelection,
  error: ErrorType,
): RoiState<ErrorType> {
  return { status: 'error', url, bbox, selection, error }
}

export function roiGeneStatsLoading(
  url: string,
  cellCount: number,
): RoiGeneStatsState<never> {
  return { status: 'loading', url, cellCount }
}

export function roiGeneStatsReady(
  url: string,
  stats: RoiGeneStats,
): RoiGeneStatsState<never> {
  return { status: 'ready', url, stats }
}

export function roiGeneStatsFailed<ErrorType extends RoiLoadErrorSummary>(
  url: string,
  error: ErrorType,
): RoiGeneStatsState<ErrorType> {
  return { status: 'error', url, error }
}

export function roiGeneViewportWarmupLoading(key: string): RoiGeneViewportWarmupState {
  return { status: 'loading', key }
}

export function roiGeneViewportWarmupReady(key: string): RoiGeneViewportWarmupState {
  return { status: 'ready', key }
}

export function roiGeneViewportWarmupFailed(key: string): RoiGeneViewportWarmupState {
  return { status: 'error', key }
}

export function roiTranscriptExportLoading(url: string): RoiTranscriptExportState<never> {
  return { status: 'loading', url }
}

export function roiTranscriptExportFailed<ErrorType extends RoiLoadErrorSummary>(
  url: string,
  error: ErrorType,
): RoiTranscriptExportState<ErrorType> {
  return { status: 'error', url, error }
}

export function roiStatusCopy<ErrorType extends RoiLoadErrorSummary>(
  roiState: RoiState<ErrorType>,
  roiMode: RoiDrawMode,
): string {
  if (roiMode === 'box') {
    return 'Drawing box'
  }

  if (roiMode === 'lasso') {
    return 'Drawing lasso'
  }

  if (roiState.status === 'loading') {
    return 'Loading'
  }

  if (roiState.status === 'ready') {
    const noun = roiState.cells.length === 1 ? 'cell' : 'cells'
    return `${roiState.cells.length.toLocaleString()}${roiState.hitCellLimit ? '+' : ''} ${noun}`
  }

  if (roiState.status === 'error') {
    return 'Unavailable'
  }

  return 'Idle'
}

export function roiSelectionLabel(selection: RoiSelection): string {
  return selection.kind === 'lasso' ? 'ROI lasso' : 'ROI box'
}

export function roiGeneStatsStatusCopy<ErrorType extends RoiLoadErrorSummary>(
  roiGeneStatsState: RoiGeneStatsState<ErrorType>,
): string {
  if (roiGeneStatsState.status === 'loading') {
    return `Genes loading for ${roiGeneStatsState.cellCount.toLocaleString()} cells`
  }

  if (roiGeneStatsState.status === 'ready') {
    if (roiGeneStatsState.stats.genes.length === 0) {
      return 'Genes: none'
    }

    return `Genes: top ${roiGeneStatsState.stats.genes.length}`
  }

  if (roiGeneStatsState.status === 'error') {
    return roiGeneStatsState.error.title
  }

  return 'Genes idle'
}

export function summarizeRoiCells(cells: readonly DatasetCell[]): RoiSummary {
  if (cells.length === 0) {
    return {
      cellCount: 0,
      meanTranscriptCount: 0,
      meanCellArea: undefined,
    }
  }

  let transcriptTotal = 0
  let cellAreaTotal = 0
  let cellAreaCount = 0

  for (const cell of cells) {
    transcriptTotal += cell.transcriptCount ?? 0

    if (cell.cellArea !== undefined) {
      cellAreaTotal += cell.cellArea
      cellAreaCount += 1
    }
  }

  return {
    cellCount: cells.length,
    meanTranscriptCount: transcriptTotal / cells.length,
    meanCellArea: cellAreaCount === 0 ? undefined : cellAreaTotal / cellAreaCount,
  }
}

export function emptyRoiGeneStats(): RoiGeneStats {
  return {
    genes: [],
    cellCount: 0,
    sampledCellCount: 0,
    totalCount: 0,
    hitCellLimit: false,
  }
}

export function roiGeneDatasetWarmupKey(datasetUrl: string): string {
  return `${datasetUrl}:roi-gene-warmup`
}

export function deferRoiGeneRefinement(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    window.setTimeout(resolve, 0)
  })
}

export function roiCellsToCsv(cells: readonly DatasetCell[]): string {
  const rows = [
    ['cell_id', 'x_centroid', 'y_centroid', 'transcript_counts', 'cell_area'],
    ...cells.map((cell) => [
      cell.id,
      String(cell.position.x),
      String(cell.position.y),
      String(cell.transcriptCount ?? ''),
      String(cell.cellArea ?? ''),
    ]),
  ]

  return rows.map((row) => row.map(csvEscape).join(',')).join('\n')
}

export function roiTranscriptsToCsv(transcripts: readonly DatasetTranscript[]): string {
  const rows = [
    [
      'cell_id',
      'feature_name',
      'x_location',
      'y_location',
      'z_location',
      'qv',
      'overlaps_nucleus',
      'is_gene',
    ],
    ...transcripts.map((transcript) => [
      transcript.cellId ?? '',
      transcript.featureName,
      String(transcript.position.x),
      String(transcript.position.y),
      transcript.zLocation === undefined ? '' : String(transcript.zLocation),
      String(transcript.qv),
      transcript.overlapsNucleus === undefined ? '' : String(transcript.overlapsNucleus),
      transcript.isGene === undefined ? '' : String(transcript.isGene),
    ]),
  ]

  return rows.map((row) => row.map(csvEscape).join(',')).join('\n')
}

export type RoiGeoJsonPropertyValue = string | number | boolean | null

export type RoiGeoJsonProperties = Readonly<Record<string, RoiGeoJsonPropertyValue>>

export function roiSelectionToGeoJson(
  selection: RoiSelection,
  properties: RoiGeoJsonProperties = {},
): string {
  const feature = {
    type: 'Feature',
    bbox: [
      selection.bbox.minX,
      selection.bbox.minY,
      selection.bbox.maxX,
      selection.bbox.maxY,
    ],
    properties: {
      roi_kind: selection.kind,
      coordinate_unit: 'micrometer',
      ...properties,
    },
    geometry: {
      type: 'Polygon',
      coordinates: [roiSelectionToPolygonRing(selection)],
    },
  } as const

  return `${JSON.stringify(
    {
      type: 'FeatureCollection',
      bbox: feature.bbox,
      features: [feature],
    },
    null,
    2,
  )}\n`
}

export function defaultRoiName(index: number): string {
  return `ROI ${index}`
}

function roiSelectionToPolygonRing(selection: RoiSelection): readonly number[][] {
  const points =
    selection.kind === 'lasso' && selection.points.length >= 3
      ? selection.points
      : [
          { x: selection.bbox.minX, y: selection.bbox.minY },
          { x: selection.bbox.maxX, y: selection.bbox.minY },
          { x: selection.bbox.maxX, y: selection.bbox.maxY },
          { x: selection.bbox.minX, y: selection.bbox.maxY },
        ]
  const ring = points.map((point) => [point.x, point.y])
  const first = ring[0]
  const last = ring.at(-1)

  if (
    first !== undefined &&
    last !== undefined &&
    (first[0] !== last[0] || first[1] !== last[1])
  ) {
    ring.push([...first])
  }

  return ring
}

function csvEscape(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}
