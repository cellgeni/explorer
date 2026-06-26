import type {
  GeneExpressionDetailMode,
  GeneExpressionLoadMode,
} from '../../data/geneExpressionLod'
import type { GeneExpressionBatchTiming } from '../../datasets/xeniumDataset'
import {
  isGeneExpressionColorScale,
  isGeneExpressionScoreMode,
  type GeneExpressionColorScale,
  type GeneExpressionScoreMode,
} from '../../rendering/deckLayers'

const GENE_SET_SYMBOL_SPLIT_PATTERN = /[\s,;]+/

export type GenePanelState<ErrorType = unknown> =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly url: string }
  | { readonly status: 'ready'; readonly url: string; readonly genes: readonly string[] }
  | { readonly status: 'error'; readonly url: string; readonly error: ErrorType }

export const IDLE_GENE_PANEL_STATE: GenePanelState<never> = { status: 'idle' }

export interface GeneExpressionLoadErrorSummary {
  readonly title: string
}

export type GeneExpressionState<
  ErrorType extends GeneExpressionLoadErrorSummary = GeneExpressionLoadErrorSummary,
> =
  | { readonly status: 'idle' }
  | { readonly status: 'waiting'; readonly message: string }
  | {
      readonly status: 'loading'
      readonly url: string
      readonly genes: readonly string[]
      readonly mode: GeneExpressionLoadMode
      readonly visibleCellCount: number
    }
  | {
      readonly status: 'ready'
      readonly url: string
      readonly genes: readonly string[]
      readonly mode: GeneExpressionLoadMode
      readonly cellCount: number
      readonly visibleCellCount: number
    }
  | {
      readonly status: 'error'
      readonly url: string
      readonly error: ErrorType
    }

export interface SavedGeneSet {
  readonly id: string
  readonly name: string
  readonly genes: readonly string[]
  readonly scoreMode: GeneExpressionScoreMode
}

export interface GeneExpressionScaleDomain {
  readonly key: string
  readonly max: number
}

export const IDLE_GENE_EXPRESSION_STATE: GeneExpressionState<never> = {
  status: 'idle',
}

export function genePanelLoadStarted(url: string): GenePanelState<never> {
  return { status: 'loading', url }
}

export function genePanelLoadReady(
  url: string,
  genes: readonly string[],
): GenePanelState<never> {
  return { status: 'ready', url, genes }
}

export function genePanelLoadFailed<ErrorType>(
  url: string,
  error: ErrorType,
): GenePanelState<ErrorType> {
  return { status: 'error', url, error }
}

export function geneExpressionWaiting(message: string): GeneExpressionState<never> {
  return { status: 'waiting', message }
}

export function geneExpressionLoadStarted(
  url: string,
  genes: readonly string[],
  mode: GeneExpressionLoadMode,
  visibleCellCount: number,
): GeneExpressionState<never> {
  return { status: 'loading', url, genes, mode, visibleCellCount }
}

export function geneExpressionLoadReady(
  url: string,
  genes: readonly string[],
  mode: GeneExpressionLoadMode,
  cellCount: number,
  visibleCellCount: number,
): GeneExpressionState<never> {
  return { status: 'ready', url, genes, mode, cellCount, visibleCellCount }
}

export function geneExpressionLoadFailed<
  ErrorType extends GeneExpressionLoadErrorSummary,
>(url: string, error: ErrorType): GeneExpressionState<ErrorType> {
  return { status: 'error', url, error }
}

export function genePanelStatusCopy<ErrorType>(
  genePanelState: GenePanelState<ErrorType>,
): string {
  if (genePanelState.status === 'loading') {
    return 'Loading'
  }

  if (genePanelState.status === 'ready') {
    return `${genePanelState.genes.length.toLocaleString()} genes`
  }

  if (genePanelState.status === 'error') {
    return 'Unavailable'
  }

  return 'Idle'
}

export function geneExpressionStatusCopy<
  ErrorType extends GeneExpressionLoadErrorSummary,
>(geneExpressionState: GeneExpressionState<ErrorType>): string {
  if (geneExpressionState.status === 'loading') {
    return `${geneExpressionModeLabel(geneExpressionState.mode)}: ${geneExpressionState.genes.join(', ')}`
  }

  if (geneExpressionState.status === 'ready') {
    const noun = geneExpressionState.cellCount === 1 ? 'cell' : 'cells'

    if (geneExpressionState.mode === 'exact-region') {
      return `Expression exact region: ${geneExpressionState.cellCount.toLocaleString()} ${noun}`
    }

    if (geneExpressionState.mode === 'overview-sampled') {
      return `Expression overview: ${geneExpressionState.cellCount.toLocaleString()} positive ${noun} across ${geneExpressionState.visibleCellCount.toLocaleString()} slide cells`
    }

    if (geneExpressionState.mode === 'all-cells') {
      return `Expression all cells: ${geneExpressionState.cellCount.toLocaleString()} positive ${noun} across ${geneExpressionState.visibleCellCount.toLocaleString()} slide cells`
    }

    if (
      geneExpressionState.mode === 'sampled' &&
      geneExpressionState.visibleCellCount > geneExpressionState.cellCount
    ) {
      const visibleNoun = geneExpressionState.visibleCellCount === 1 ? 'cell' : 'cells'

      return `Expression sample: ${geneExpressionState.cellCount.toLocaleString()} of ${geneExpressionState.visibleCellCount.toLocaleString()} visible ${visibleNoun}`
    }

    return `Expression: ${geneExpressionState.cellCount.toLocaleString()} ${noun}`
  }

  if (geneExpressionState.status === 'waiting') {
    return geneExpressionState.message
  }

  if (geneExpressionState.status === 'error') {
    return `Expression failed - ${geneExpressionState.error.title}`
  }

  return 'Expression: none'
}

export function geneExpressionModeLabel(mode: GeneExpressionLoadMode): string {
  if (mode === 'overview-sampled') {
    return 'Expression overview'
  }

  if (mode === 'sampled') {
    return 'Expression sample'
  }

  if (mode === 'exact-region') {
    return 'Expression exact region'
  }

  if (mode === 'all-cells') {
    return 'Expression all cells'
  }

  return 'Expression'
}

export function formatGeneExpressionTiming(
  timing: GeneExpressionBatchTiming | undefined,
): string {
  if (timing === undefined) {
    return 'timing unavailable'
  }

  const summary = [
    `total ${Math.round(timing.totalMs)} ms`,
    `viewport ${Math.round(timing.viewportCellsMs)} ms`,
    `matrix ${Math.round(timing.matrixReadMs)} ms`,
    `score ${Math.round(timing.scoreCellsMs)} ms`,
  ].join(', ')

  return timing.stageSummary === undefined
    ? summary
    : `${summary}; stages ${timing.stageSummary}`
}

export function isGeneExpressionDetailMode(
  value: string,
): value is GeneExpressionDetailMode {
  return value === 'auto' || value === 'exact-region' || value === 'all-cells'
}

export function geneExpressionScaleKeyFor(
  datasetUrl: string,
  scoreMode: GeneExpressionScoreMode,
  genes: readonly string[],
): string {
  return [datasetUrl, scoreMode, genes.join('|')].join('::')
}

export function parseGeneExpressionColorScale(
  value: string | undefined,
): GeneExpressionColorScale | undefined {
  return value !== undefined && isGeneExpressionColorScale(value) ? value : undefined
}

export function parseGeneExpressionScoreMode(
  value: string | undefined,
): GeneExpressionScoreMode | undefined {
  return value !== undefined && isGeneExpressionScoreMode(value) ? value : undefined
}

export function parseGeneExpressionDetailMode(
  value: string | undefined,
): GeneExpressionDetailMode | undefined {
  return value !== undefined && isGeneExpressionDetailMode(value) ? value : undefined
}

export function formatGeneScaleValue(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0'
  }

  return value.toLocaleString(undefined, {
    maximumFractionDigits: value < 10 ? 2 : 1,
  })
}

export function filterGeneOptions(
  genes: readonly string[],
  search: string,
  selectedGenes: readonly string[],
  options: { readonly limit?: number } = {},
): readonly string[] {
  const normalizedSearch = search.trim().toLowerCase()
  const selected = new Set(selectedGenes)
  const matches: string[] = []

  for (const gene of genes) {
    if (selected.has(gene)) {
      continue
    }

    if (normalizedSearch.length === 0 || gene.toLowerCase().includes(normalizedSearch)) {
      matches.push(gene)
    }

    if (options.limit !== undefined && matches.length >= options.limit) {
      break
    }
  }

  return matches
}

export function parseGeneSetSymbols(
  value: string,
  availableGenes: readonly string[],
): readonly string[] {
  if (value.trim().length === 0 || availableGenes.length === 0) {
    return []
  }

  const availableGenesByNormalizedName = new Map<string, string>()

  for (const gene of availableGenes) {
    availableGenesByNormalizedName.set(gene.toLowerCase(), gene)
  }

  const selectedGenes = new Set<string>()
  const parsedGenes: string[] = []

  for (const symbol of value.split(GENE_SET_SYMBOL_SPLIT_PATTERN)) {
    const normalizedSymbol = symbol.trim().toLowerCase()

    if (normalizedSymbol.length === 0) {
      continue
    }

    const gene = availableGenesByNormalizedName.get(normalizedSymbol)

    if (gene === undefined || selectedGenes.has(gene)) {
      continue
    }

    selectedGenes.add(gene)
    parsedGenes.push(gene)
  }

  return parsedGenes.sort((left, right) => left.localeCompare(right))
}

export function defaultGeneSetName(genes: readonly string[]): string {
  if (genes.length === 0) {
    return 'Selected genes'
  }

  if (genes.length <= 3) {
    return genes.join(', ')
  }

  return `${genes.slice(0, 3).join(', ')} +${genes.length - 3}`
}
