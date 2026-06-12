import type { BBox, DataPoint } from '../../data/coords'
import type { RoiGeneStats } from '../../data/roiGeneStats'
import type { RoiSelectionInput } from '../../data/roiSelection'
import type { DatasetCell } from '../../datasets/xeniumDataset'

export const MAGIC_LENS_CELL_LIMIT = 25_000
export const MAGIC_LENS_TOP_GENE_LIMIT = 8
export const MAGIC_LENS_GENE_STATS_LIMIT = 10_000

export type MagicLensScope = 'cursor' | 'viewport' | 'roi'

export interface MagicLensSummary {
  readonly transcriptCount: number
  readonly cellCount: number
  readonly geneCount: number
  readonly selectedGeneTranscriptCount: number
  readonly topGenes: readonly MagicLensGeneSummary[]
  readonly hitLimit: boolean
}

interface MagicLensGeneSummary {
  readonly gene: string
  readonly count: number
  readonly percentTotal: number
  readonly selected: boolean
}

export interface MagicLensCircleFilter {
  readonly center: DataPoint
  readonly radiusMicrometers: number
}

export interface MagicLensLoadErrorSummary {
  readonly title: string
}

export type MagicLensState<
  ErrorType extends MagicLensLoadErrorSummary = MagicLensLoadErrorSummary,
> =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly url: string; readonly scope: MagicLensScope }
  | {
      readonly status: 'ready'
      readonly url: string
      readonly scope: MagicLensScope
      readonly summary: MagicLensSummary
    }
  | {
      readonly status: 'error'
      readonly url: string
      readonly scope: MagicLensScope
      readonly error: ErrorType
    }

export interface MagicLensQueryDetail {
  readonly center: DataPoint
  readonly radiusMicrometers: number
}

export function magicLensScopeLabel(scope: MagicLensScope): string {
  if (scope === 'cursor') {
    return 'Cursor'
  }

  return scope === 'roi' ? 'ROI' : 'Viewport'
}

export function parseMagicLensScope(value: string | undefined): MagicLensScope | null {
  if (value === 'cursor' || value === 'viewport' || value === 'roi') {
    return value
  }

  return null
}

export function resolveMagicLensSelection(
  scope: MagicLensScope,
  viewportDetail: { readonly bbox: BBox } | null,
  roiSelection: RoiSelectionInput | null,
): RoiSelectionInput | null {
  if (scope === 'roi') {
    return roiSelection
  }

  if (scope === 'cursor') {
    return null
  }

  return viewportDetail?.bbox ?? null
}

export function summarizeMagicLensCells(
  cells: readonly DatasetCell[],
  stats: RoiGeneStats,
  selectedGenes: readonly string[],
  options: {
    readonly hitLimit?: boolean
  },
): MagicLensSummary {
  const selectedGeneKeys = new Set(selectedGenes.map((gene) => gene.toLocaleLowerCase()))
  let selectedGeneTranscriptCount = 0
  let transcriptCount = 0

  for (const cell of cells) {
    transcriptCount += cell.transcriptCount ?? 0
  }

  for (const gene of stats.genes) {
    if (selectedGeneKeys.has(gene.gene.toLocaleLowerCase())) {
      selectedGeneTranscriptCount += gene.count
    }
  }

  const topGenes = stats.genes
    .map((gene) => ({
      gene: gene.gene,
      count: gene.count,
      percentTotal: gene.percentTotal,
      selected: selectedGeneKeys.has(gene.gene.toLocaleLowerCase()),
    }))
    .slice(0, MAGIC_LENS_TOP_GENE_LIMIT)

  return {
    transcriptCount,
    cellCount: cells.length,
    geneCount: stats.genes.length,
    selectedGeneTranscriptCount,
    topGenes,
    hitLimit: options.hitLimit ?? false,
  }
}

export function magicLensStatusCopy<ErrorType extends MagicLensLoadErrorSummary>(
  state: MagicLensState<ErrorType>,
  scope: MagicLensScope,
  loadStatus: 'idle' | 'loading' | 'ready' | 'error',
  canScan: boolean,
  active: boolean,
): string {
  if (state.status === 'loading') {
    return `Scanning ${magicLensScopeLabel(state.scope)}`
  }

  if (state.status === 'ready') {
    return `${state.summary.transcriptCount.toLocaleString()} transcripts`
  }

  if (state.status === 'error') {
    return state.error.title
  }

  if (loadStatus !== 'ready') {
    return 'Load dataset'
  }

  if (scope === 'cursor') {
    return active ? 'Move cursor' : 'Lens off'
  }

  if (canScan) {
    return 'Ready'
  }

  return scope === 'roi' ? 'ROI required' : 'Viewport pending'
}

export function filterCellsForCircle(
  cells: readonly DatasetCell[],
  filter: MagicLensCircleFilter,
): readonly DatasetCell[] {
  const radiusSquared = filter.radiusMicrometers * filter.radiusMicrometers

  return cells.filter((cell) => {
    const deltaX = cell.position.x - filter.center.x
    const deltaY = cell.position.y - filter.center.y

    return deltaX * deltaX + deltaY * deltaY <= radiusSquared
  })
}

export function magicLensDetailQueryKey(
  detail: MagicLensQueryDetail,
  minQv: number,
  selectedGenes: readonly string[],
): string {
  const roundedX = Math.round(detail.center.x / 4)
  const roundedY = Math.round(detail.center.y / 4)
  const selectedGeneKey = selectedGenes
    .map((gene) => gene.toLocaleLowerCase())
    .sort()
    .join(',')

  return [
    roundedX,
    roundedY,
    Math.round(detail.radiusMicrometers),
    minQv,
    selectedGeneKey,
  ].join(':')
}

export function normalizeMagicLensRadius(value: number): number {
  if (!Number.isFinite(value)) {
    return 80
  }

  return Math.max(10, Math.min(500, Math.round(value)))
}

export function normalizeMagicLensMinQv(value: number): number {
  if (!Number.isFinite(value)) {
    return 20
  }

  return Math.max(0, Math.min(40, Math.round(value)))
}
