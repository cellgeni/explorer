import type {
  GeneExpressionDetailMode,
  GeneExpressionLoadMode,
} from '../../data/geneExpressionLod'
import { escapeLinkPart, unescapeLinkPart } from '../../data/shareableState'
import type {
  GeneExpressionBatch,
  GeneExpressionBatchTiming,
} from '../../datasets/xeniumDataset'
import {
  DEFAULT_GENE_EXPRESSION_SCORE_MODE,
  isGeneExpressionColorScale,
  isGeneExpressionScoreMode,
  type GeneExpressionColorScale,
  type GeneExpressionScoreMode,
} from '../../rendering/deckLayers'
import { AUTO_GENE_SCALE_PERCENTILE } from './geneScaleRange'

const GENE_SET_SYMBOL_SPLIT_PATTERN = /[\s,;]+/

export type GenePanelState<ErrorType = unknown> =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly url: string }
  | {
      readonly status: 'ready'
      readonly url: string
      readonly genes: readonly string[]
      // Another name each gene can be searched by, such as an H5AD gene's
      // Ensembl ID when it is listed by symbol.
      readonly aliases?: ReadonlyMap<string, string>
    }
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

// What the Gene scale's top has seen for one dataset, score mode and gene
// selection (`key`) at one percentile: it keeps the highest, so the scale
// does not shrink as the view moves.
export interface GeneExpressionScaleDomain {
  readonly key: string
  readonly percentile: number
  // The highest top (that percentile) of the batches read.
  readonly top: number
  readonly highest: number
  // Visium HD: the same for the selection's other bin sizes, as a 16 µm bin
  // sums 64 2 µm ones. Zooming back to a size restores its top.
  readonly otherBinSizes?: readonly GeneExpressionScaleDomain[]
}

export const EMPTY_GENE_EXPRESSION_SCALE_DOMAIN: GeneExpressionScaleDomain = {
  key: '',
  percentile: AUTO_GENE_SCALE_PERCENTILE,
  top: 0,
  highest: 0,
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
  aliases?: ReadonlyMap<string, string>,
): GenePanelState<never> {
  return {
    status: 'ready',
    url,
    genes: [...genes].sort((left, right) => left.localeCompare(right)),
    ...(aliases === undefined || aliases.size === 0 ? {} : { aliases }),
  }
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
>(
  geneExpressionState: GeneExpressionState<ErrorType>,
  // Plural: cells, spots or bins.
  elementNoun = 'cells',
): string {
  if (geneExpressionState.status === 'loading') {
    return `${geneExpressionModeLabel(geneExpressionState.mode, elementNoun)}: ${geneExpressionState.genes.join(', ')}`
  }

  if (geneExpressionState.status === 'ready') {
    const noun =
      geneExpressionState.cellCount === 1 ? elementNoun.replace(/s$/, '') : elementNoun
    const positive = `${geneExpressionState.cellCount.toLocaleString()} positive ${noun}`
    const across = geneExpressionState.visibleCellCount.toLocaleString()

    if (geneExpressionState.mode === 'exact-region') {
      return `Expression exact region: ${geneExpressionState.cellCount.toLocaleString()} ${noun}`
    }

    if (geneExpressionState.mode === 'overview-sampled') {
      return `Expression overview: ${positive} across ${across} slide ${elementNoun}`
    }

    if (geneExpressionState.mode === 'all-cells') {
      return `Expression all ${elementNoun}: ${positive} across ${across} slide ${elementNoun}`
    }

    if (geneExpressionState.mode === 'sampled') {
      return `Expression sample: ${positive} across ${across} visible ${elementNoun}`
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

export function geneExpressionModeLabel(
  mode: GeneExpressionLoadMode,
  // Plural: cells, spots or bins.
  elementNoun = 'cells',
): string {
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
    return `Expression all ${elementNoun}`
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

const SCALE_KEY_BIN_SIZE = '::bin='

// The scale key of a batch: Visium HD bins add their size, as zoomed out a
// 2 µm or 8 µm selection reads 16 µm bins.
export function geneExpressionBatchScaleKey(
  key: string,
  batch: Pick<GeneExpressionBatch, 'elements'>,
): string {
  const binSize = batch.elements[0]?.binSizeMicrometers

  return binSize === undefined ? key : `${key}${SCALE_KEY_BIN_SIZE}${binSize.toString()}`
}

// What the scale has seen for a batch's key at a percentile, or nothing.
export function rememberedGeneExpressionScale(
  domain: GeneExpressionScaleDomain,
  key: string,
  percentile: number,
): GeneExpressionScaleDomain {
  return (
    [domain, ...(domain.otherBinSizes ?? [])].find(
      (seen) => seen.key === key && seen.percentile === percentile,
    ) ?? EMPTY_GENE_EXPRESSION_SCALE_DOMAIN
  )
}

// The domain once a batch with this spread has been read under `key`. It keeps
// what the selection's other bin sizes saw at the same percentile.
export function geneExpressionScaleDomainWith(
  domain: GeneExpressionScaleDomain,
  key: string,
  percentile: number,
  spread: { readonly top: number; readonly highest: number },
): GeneExpressionScaleDomain {
  const seen = rememberedGeneExpressionScale(domain, key, percentile)

  if (seen === domain && seen.top >= spread.top && seen.highest >= spread.highest) {
    return domain
  }

  const selection = key.split(SCALE_KEY_BIN_SIZE)[0]
  const otherBinSizes = [domain, ...(domain.otherBinSizes ?? [])]
    .filter(
      (other) =>
        other.key !== key &&
        other.percentile === percentile &&
        other.key.split(SCALE_KEY_BIN_SIZE)[0] === selection,
    )
    .map(({ key: otherKey, percentile: otherPercentile, top, highest }) => ({
      key: otherKey,
      percentile: otherPercentile,
      top,
      highest,
    }))

  return {
    key,
    percentile,
    top: Math.max(seen.top, spread.top),
    highest: Math.max(seen.highest, spread.highest),
    ...(otherBinSizes.length === 0 ? {} : { otherBinSizes }),
  }
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
  if (!Number.isFinite(value) || value === 0) {
    return '0'
  }

  // Negative only for a range set below zero (z-scores).
  return value.toLocaleString(undefined, {
    maximumFractionDigits: Math.abs(value) < 10 ? 2 : 1,
  })
}

// How well a gene matches a lower-case search: 0 exact (name or alias),
// 1 name prefix, 2 alias prefix, 3 name substring, 4 alias substring, or null.
function geneSearchRank(
  gene: string,
  normalizedSearch: string,
  alias: string | undefined,
): number | null {
  const name = gene.toLowerCase()
  const normalizedAlias = alias?.toLowerCase()

  if (name === normalizedSearch || normalizedAlias === normalizedSearch) return 0
  if (name.startsWith(normalizedSearch)) return 1
  if (normalizedAlias?.startsWith(normalizedSearch) === true) return 2
  if (name.includes(normalizedSearch)) return 3
  if (normalizedAlias?.includes(normalizedSearch) === true) return 4
  return null
}

// Genes that match the search and are not selected yet: exact matches first,
// then name prefixes, alias prefixes and substrings, each in panel order. An
// empty search lists every unselected gene in panel order.
export function filterGeneOptions(
  genes: readonly string[],
  search: string,
  selectedGenes: readonly string[],
  options: {
    readonly limit?: number
    readonly aliases?: ReadonlyMap<string, string> | undefined
  } = {},
): readonly string[] {
  const normalizedSearch = search.trim().toLowerCase()
  const selected = new Set(selectedGenes)
  const limit = options.limit ?? Infinity

  if (normalizedSearch.length === 0) {
    const matches: string[] = []

    for (const gene of genes) {
      if (matches.length >= limit) break
      if (!selected.has(gene)) matches.push(gene)
    }

    return matches
  }

  const ranked: { readonly gene: string; readonly rank: number }[] = []

  for (const gene of genes) {
    if (selected.has(gene)) continue
    const rank = geneSearchRank(gene, normalizedSearch, options.aliases?.get(gene))
    if (rank !== null) ranked.push({ gene, rank })
  }

  // Array sort is stable, so panel order holds within a rank.
  return ranked
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map(({ gene }) => gene)
}

// What an empty search result says. The list leaves selected genes out, so a
// search for one of them says it is already selected.
export function geneSearchEmptyMessage(
  search: string,
  selectedGenes: readonly string[],
  options: {
    readonly noun: 'genes' | 'features'
    readonly aliases?: ReadonlyMap<string, string> | undefined
  },
): string {
  const normalizedSearch = search.trim().toLowerCase()
  const matches =
    normalizedSearch.length === 0
      ? []
      : selectedGenes.filter(
          (gene) =>
            geneSearchRank(gene, normalizedSearch, options.aliases?.get(gene)) !== null,
        )

  if (matches.length === 0) return `No matching ${options.noun}`

  const names =
    matches.length <= 3
      ? matches.join(', ')
      : `${matches.slice(0, 3).join(', ')} and ${(matches.length - 3).toLocaleString()} more`

  return `${names} ${matches.length === 1 ? 'is' : 'are'} already selected`
}

export function parseGeneSetSymbols(
  value: string,
  availableGenes: readonly string[],
  aliases?: ReadonlyMap<string, string>,
): readonly string[] {
  if (value.trim().length === 0 || availableGenes.length === 0) {
    return []
  }

  const availableGenesByNormalizedName = new Map<string, string>()

  for (const gene of availableGenes) {
    availableGenesByNormalizedName.set(gene.toLowerCase(), gene)
  }

  // Gene names win over an alias spelled the same way.
  for (const [gene, alias] of aliases ?? []) {
    const normalizedAlias = alias.toLowerCase()

    if (!availableGenesByNormalizedName.has(normalizedAlias)) {
      availableGenesByNormalizedName.set(normalizedAlias, gene)
    }
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

// A removed gene set put back at its old place (15.3-C). A set saved since
// under the same name, or the same set, wins.
export function withGeneSetAt(
  sets: readonly SavedGeneSet[],
  geneSet: SavedGeneSet,
  index: number,
): readonly SavedGeneSet[] {
  const name = geneSet.name.toLowerCase()
  if (sets.some((set) => set.id === geneSet.id || set.name.toLowerCase() === name)) {
    return sets
  }

  const at = Math.min(Math.max(index, 0), sets.length)
  return [...sets.slice(0, at), geneSet, ...sets.slice(at)]
}

// A saved set's ID: its name, which no other saved set has in any case,
// since saving under a saved name replaces that set.
export function savedGeneSetId(name: string): string {
  return `gene-set:${name.toLowerCase()}`
}

// `geneSets=`: the saved gene sets in their listed order, joined by `;`, each
// `name|score|genes` with the genes joined by `,`. `%`, `;`, `|` and `,`
// inside a name or gene are written as `%25`, `%3B`, `%7C` and `%2C`.
export function formatGeneSetsLink(sets: readonly SavedGeneSet[]): string | undefined {
  if (sets.length === 0) return undefined

  return sets
    .map((set) =>
      [
        escapeLinkPart(set.name),
        set.scoreMode,
        set.genes.map(escapeLinkPart).join(','),
      ].join('|'),
    )
    .join(';')
}

// The sets a link names. A set without a name or genes is dropped, as is a
// later one under a name already read; an unknown score reads as the default.
export function parseGeneSetsLink(value: string | undefined): readonly SavedGeneSet[] {
  if (value === undefined || value === '') return []

  const sets: SavedGeneSet[] = []
  const ids = new Set<string>()

  for (const part of value.split(';')) {
    const [rawName = '', rawScoreMode, rawGenes = ''] = part.split('|')
    const name = unescapeLinkPart(rawName).trim()
    const genes = rawGenes
      .split(',')
      .map((gene) => unescapeLinkPart(gene).trim())
      .filter((gene) => gene !== '')
    const id = savedGeneSetId(name)

    if (name === '' || genes.length === 0 || ids.has(id)) continue

    ids.add(id)
    sets.push({
      id,
      name,
      genes,
      scoreMode:
        parseGeneExpressionScoreMode(rawScoreMode) ?? DEFAULT_GENE_EXPRESSION_SCORE_MODE,
    })
  }

  return sets
}
