import type { DataPoint } from '../../data/coords'
import type { RoiGeneStats } from '../../data/roiGeneStats'
import { roiSelectionContains, type RoiSelection } from '../../data/roiSelection'
import type { RoiLoadErrorSummary } from './roiModel'

// Enriched genes (UNIFIED_PLAN.md, 15.4-B). The Selection card ranks the
// genes in a selection by the log2 fold change of their mean expression
// inside it over a reference sample from the rest of the tissue. The method
// note is in docs/ui-reference.md (Selection › Genes).

// Added to both means, so a gene absent outside does not rank as infinite
// and a few counts in a small selection do not dominate. In counts (or
// stored values) per cell.
export const ENRICHMENT_PSEUDOCOUNT = 0.1

// The reference sample: runs of consecutive cells (or bins) spread evenly
// through the dataset's list. Lists are in matrix row order, so where the
// matrix is stored by cell each run reads one or two chunks, and the runs
// together cover the tissue. Fewer, longer runs read fewer chunks.
export const REFERENCE_BLOCK_COUNT = 8
export const REFERENCE_BLOCK_SIZE = 64

// Gene stats for every gene, not only the top 10, so each can be compared.
export const ALL_GENES = Number.MAX_SAFE_INTEGER

export const RANKED_GENE_LIMIT = 20
export const DEFAULT_MIN_PERCENT_INSIDE = 10
export const MIN_PERCENT_OPTIONS = [0, 5, 10, 25, 50] as const

export type RoiGeneSort = 'enriched' | 'abundant'

export type RoiReferenceState<
  ErrorType extends RoiLoadErrorSummary = RoiLoadErrorSummary,
> =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly url: string; readonly cellCount: number }
  | { readonly status: 'ready'; readonly url: string; readonly stats: RoiGeneStats }
  // No reference cells outside the selection.
  | { readonly status: 'unavailable'; readonly url: string }
  | { readonly status: 'error'; readonly url: string; readonly error: ErrorType }

export const IDLE_ROI_REFERENCE_STATE: RoiReferenceState<never> = { status: 'idle' }

export function roiReferenceLoading(
  url: string,
  cellCount: number,
): RoiReferenceState<never> {
  return { status: 'loading', url, cellCount }
}

export function roiReferenceReady(
  url: string,
  stats: RoiGeneStats,
): RoiReferenceState<never> {
  return { status: 'ready', url, stats }
}

export function roiReferenceUnavailable(url: string): RoiReferenceState<never> {
  return { status: 'unavailable', url }
}

export function roiReferenceFailed<ErrorType extends RoiLoadErrorSummary>(
  url: string,
  error: ErrorType,
): RoiReferenceState<ErrorType> {
  return { status: 'error', url, error }
}

// The indices of the reference sample in a list of `length` elements.
export function referenceSampleIndices(
  length: number,
  blockCount = REFERENCE_BLOCK_COUNT,
  blockSize = REFERENCE_BLOCK_SIZE,
): readonly number[] {
  if (length <= 0) return []
  if (length <= blockCount * blockSize) {
    return Array.from({ length }, (_, index) => index)
  }

  const stride = length / blockCount
  const indices: number[] = []

  for (let block = 0; block < blockCount; block += 1) {
    const start = Math.min(Math.floor(block * stride), length - blockSize)
    for (let offset = 0; offset < blockSize; offset += 1) {
      indices.push(start + offset)
    }
  }

  return indices
}

// The reference elements outside the selection.
export function referenceOutsideSelection<Element>(
  reference: readonly Element[],
  selection: RoiSelection,
  positionOf: (element: Element) => DataPoint,
): readonly Element[] {
  return reference.filter(
    (element) => !roiSelectionContains(selection, positionOf(element)),
  )
}

export function log2FoldChange(
  meanInside: number,
  meanOutside: number,
  pseudocount = ENRICHMENT_PSEUDOCOUNT,
): number {
  return Math.log2((meanInside + pseudocount) / (meanOutside + pseudocount))
}

export interface RankedRoiGene {
  readonly gene: string
  // Summed over the sampled cells inside.
  readonly count: number
  readonly meanInside: number
  readonly percentInside: number
  readonly percentTotal: number
  // Null until the reference is read.
  readonly meanOutside: number | null
  readonly percentOutside: number | null
  readonly log2FoldChange: number | null
}

export interface RankRoiGenesOptions {
  readonly sort: RoiGeneSort
  // Genes expressed in fewer of the cells inside are left out.
  readonly minPercentInside: number
  readonly limit?: number
}

// Genes detected inside, filtered by the share of cells expressing them and
// sorted by fold change (enriched) or count (most abundant). Enriched needs
// the reference; without it the order is by count.
export function rankRoiGenes(
  inside: RoiGeneStats,
  outside: RoiGeneStats | null,
  { sort, minPercentInside, limit = RANKED_GENE_LIMIT }: RankRoiGenesOptions,
): readonly RankedRoiGene[] {
  const outsideByGene = new Map(outside?.genes.map((gene) => [gene.gene, gene]) ?? [])
  const outsideCells = outside?.sampledCellCount ?? 0

  const ranked = inside.genes
    .filter((gene) => gene.count > 0 && gene.percentCells >= minPercentInside)
    .map((gene): RankedRoiGene => {
      if (outside === null || outsideCells === 0) {
        return {
          gene: gene.gene,
          count: gene.count,
          meanInside: gene.meanPerCell,
          percentInside: gene.percentCells,
          percentTotal: gene.percentTotal,
          meanOutside: null,
          percentOutside: null,
          log2FoldChange: null,
        }
      }

      const other = outsideByGene.get(gene.gene)
      const meanOutside = other?.meanPerCell ?? 0

      return {
        gene: gene.gene,
        count: gene.count,
        meanInside: gene.meanPerCell,
        percentInside: gene.percentCells,
        percentTotal: gene.percentTotal,
        meanOutside,
        percentOutside: other?.percentCells ?? 0,
        log2FoldChange: log2FoldChange(gene.meanPerCell, meanOutside),
      }
    })

  const byCount = (a: RankedRoiGene, b: RankedRoiGene) =>
    b.count - a.count || a.gene.localeCompare(b.gene)

  ranked.sort(
    sort === 'enriched' && outside !== null && outsideCells > 0
      ? (a, b) =>
          (b.log2FoldChange ?? 0) - (a.log2FoldChange ?? 0) ||
          b.meanInside - a.meanInside ||
          a.gene.localeCompare(b.gene)
      : byCount,
  )

  return ranked.slice(0, limit)
}

// "+2.4", "−0.8", "0.0", with a true minus sign.
export function formatLog2FoldChange(value: number): string {
  const rounded = Math.round(value * 10) / 10
  if (rounded === 0) return '0.0'
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded).toFixed(1)}`
}
