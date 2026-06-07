import type {
  GeneExpressionDetailMode,
  GeneExpressionLoadMode,
} from '../../data/geneExpressionLod'
import {
  isGeneExpressionColorScale,
  isGeneExpressionScoreMode,
  type GeneExpressionColorScale,
  type GeneExpressionScoreMode,
} from '../../rendering/deckLayers'

const GENE_SET_SYMBOL_SPLIT_PATTERN = /[\s,;]+/

type GenePanelDisplayState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly url: string }
  | { readonly status: 'ready'; readonly url: string; readonly genes: readonly string[] }
  | { readonly status: 'error'; readonly url: string; readonly error: unknown }

type GeneExpressionDisplayState =
  | { readonly status: 'idle' }
  | {
      readonly status: 'loading'
      readonly url: string
      readonly mode: GeneExpressionLoadMode
      readonly genes: readonly string[]
    }
  | {
      readonly status: 'waiting'
      readonly message: string
    }
  | {
      readonly status: 'ready'
      readonly url: string
      readonly mode: GeneExpressionLoadMode
      readonly cellCount: number
      readonly visibleCellCount: number
    }
  | {
      readonly status: 'error'
      readonly url: string
      readonly error: { readonly title: string }
    }

export function genePanelStatusCopy(genePanelState: GenePanelDisplayState): string {
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

export function geneExpressionStatusCopy(
  geneExpressionState: GeneExpressionDisplayState,
): string {
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

  return 'Expression'
}

export function isGeneExpressionDetailMode(
  value: string,
): value is GeneExpressionDetailMode {
  return value === 'auto' || value === 'exact-region'
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

export function filterGeneOptions(
  genes: readonly string[],
  search: string,
  selectedGenes: readonly string[],
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

    if (matches.length >= 24) {
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
