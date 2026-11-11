import type { Color } from '@deck.gl/core'
import type {
  TranscriptFeatureFilterMode,
  TranscriptPoint,
} from '../../data/transcriptOverlay'

// The transcript gene legend (UNIFIED_PLAN.md, 15.4-C): with points coloured
// by gene, each gene shown gets a swatch, an eye and its count, in the
// Transcripts section and the canvas legend. Colours can be edited.

// Selected genes take these, so each has its own colour. The first eight
// are the old feature palette.
export const TRANSCRIPT_GENE_PALETTE = [
  '#4cd3c2',
  '#f8c550',
  '#e7617e',
  '#93c5fd',
  '#a78bfa',
  '#84cc16',
  '#fb923c',
  '#f472b6',
  '#38bdf8',
  '#facc15',
  '#c084fc',
  '#4ade80',
] as const

// Points are drawn a little see-through, as before.
export const TRANSCRIPT_GENE_ALPHA = 235

// With All features, the genes with most points in view are listed.
export const TRANSCRIPT_GENE_LIST_LIMIT = 24

// Other genes keep a colour from their name, so it does not change as the
// view moves.
export function hashedTranscriptGeneColor(gene: string): string {
  let hash = 0

  for (let index = 0; index < gene.length; index += 1) {
    hash = (hash * 31 + gene.charCodeAt(index)) >>> 0
  }

  return TRANSCRIPT_GENE_PALETTE[hash % 8] ?? TRANSCRIPT_GENE_PALETTE[0]
}

// Each selected gene keeps the colour it was given when it was selected; a
// new one takes the first colour no other selected gene has. (The list is
// sorted, so colours by position would move when a gene is added.)
export function assignTranscriptGeneColors(
  previous: Readonly<Record<string, string>>,
  selectedGenes: readonly string[],
): Readonly<Record<string, string>> {
  const assigned: Record<string, string> = {}

  for (const gene of selectedGenes) {
    const color = previous[gene]
    if (color !== undefined) assigned[gene] = color
  }

  for (const gene of selectedGenes) {
    if (assigned[gene] !== undefined) continue
    const used = new Set(Object.values(assigned))
    const free = TRANSCRIPT_GENE_PALETTE.find((color) => !used.has(color))
    assigned[gene] =
      free ??
      TRANSCRIPT_GENE_PALETTE[
        Object.keys(assigned).length % TRANSCRIPT_GENE_PALETTE.length
      ] ??
      TRANSCRIPT_GENE_PALETTE[0]
  }

  return assigned
}

// An edited colour, else the selected gene's, else the one from the name.
export function transcriptGeneColor(
  gene: string,
  assigned: Readonly<Record<string, string>>,
  overrides: Readonly<Record<string, string>>,
): string {
  return overrides[gene] ?? assigned[gene] ?? hashedTranscriptGeneColor(gene)
}

// "#4cd3c2" to a deck.gl colour; anything else to the first colour.
export function hexToTranscriptColor(hex: string): Color {
  const match = /^#([0-9a-f]{6})$/i.exec(hex)
  const value = Number.parseInt(match?.[1] ?? '4cd3c2', 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255, TRANSCRIPT_GENE_ALPHA]
}

export function countTranscriptsByGene(
  points: readonly Pick<TranscriptPoint, 'featureName'>[],
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>()

  for (const point of points) {
    counts.set(point.featureName, (counts.get(point.featureName) ?? 0) + 1)
  }

  return counts
}

export interface TranscriptGeneLegendItem {
  readonly gene: string
  // CSS hex.
  readonly color: string
  readonly visible: boolean
  // Points loaded in view, hidden ones included.
  readonly count: number
}

export interface TranscriptGeneLegend {
  readonly items: readonly TranscriptGeneLegendItem[]
  // Genes with points that the list leaves out (All features).
  readonly moreCount: number
}

export const EMPTY_TRANSCRIPT_GENE_LEGEND: TranscriptGeneLegend = {
  items: [],
  moreCount: 0,
}

// Selected genes, in order, when the filter is Selected genes; otherwise
// the genes with most points loaded.
export function transcriptGeneLegend({
  assigned,
  counts,
  filterMode,
  hiddenGenes,
  overrides,
  selectedGenes,
  limit = TRANSCRIPT_GENE_LIST_LIMIT,
}: {
  readonly assigned: Readonly<Record<string, string>>
  readonly counts: ReadonlyMap<string, number>
  readonly filterMode: TranscriptFeatureFilterMode
  readonly hiddenGenes: ReadonlySet<string>
  readonly overrides: Readonly<Record<string, string>>
  readonly selectedGenes: readonly string[]
  readonly limit?: number
}): TranscriptGeneLegend {
  const item = (gene: string): TranscriptGeneLegendItem => ({
    gene,
    color: transcriptGeneColor(gene, assigned, overrides),
    visible: !hiddenGenes.has(gene),
    count: counts.get(gene) ?? 0,
  })

  if (filterMode === 'selected' && selectedGenes.length > 0) {
    return { items: selectedGenes.map(item), moreCount: 0 }
  }

  const genes = [...counts.entries()]
    .sort(
      ([geneA, countA], [geneB, countB]) => countB - countA || geneA.localeCompare(geneB),
    )
    .map(([gene]) => gene)

  return {
    items: genes.slice(0, limit).map(item),
    moreCount: Math.max(0, genes.length - limit),
  }
}
