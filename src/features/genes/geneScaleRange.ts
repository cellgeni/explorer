// The Gene scale's range (Cells › Cell color). An end left null follows the
// data: 0 at the bottom, the 99th percentile of the scores at the top. Kept
// across genes and datasets until set back to Auto, so sections and genes
// compare on one scale.
export interface GeneScaleRange {
  readonly min: number | null
  readonly max: number | null
}

export interface GeneScaleBounds {
  readonly min: number
  readonly max: number
}

export const AUTO_GENE_SCALE_RANGE: GeneScaleRange = { min: null, max: null }

export function isAutoGeneScaleRange(range: GeneScaleRange): boolean {
  return range.min === null && range.max === null
}

export function geneScaleBounds(range: GeneScaleRange, autoMax: number): GeneScaleBounds {
  return { min: range.min ?? 0, max: range.max ?? autoMax }
}

// Auto puts the top of the scale at this percentile of the scores above 0,
// not at the highest score, so a few outlier cells do not squeeze the rest
// into the bottom colours. Cells above it get the top colour.
export const AUTO_GENE_SCALE_PERCENTILE = 99

export interface GeneScoreSpread {
  // Where Auto puts the top of the scale.
  readonly top: number
  readonly highest: number
}

export const EMPTY_GENE_SCORE_SPREAD: GeneScoreSpread = { top: 0, highest: 0 }

// The Auto top and the highest of `scores`. The percentile is by nearest rank
// over the scores above 0: zeros would put it at 0 for a gene that few cells
// express. It is a score some cell has, and the highest with 100 or fewer.
export function geneScoreSpread(scores: readonly number[]): GeneScoreSpread {
  let count = 0
  let highest = 0

  for (const score of scores) {
    if (score > 0) {
      count += 1
      highest = Math.max(highest, score)
    }
  }

  if (count === 0) return EMPTY_GENE_SCORE_SPREAD

  const positive = new Float64Array(count)
  let index = 0

  for (const score of scores) {
    if (score > 0) {
      positive[index] = score
      index += 1
    }
  }

  const rank = Math.ceil((AUTO_GENE_SCALE_PERCENTILE / 100) * count)

  return { top: selectKth(positive, rank - 1), highest }
}

// The k-th smallest value (from 0), reordering `values`. Quickselect, not a
// sort: an expression batch can hold 500,000 cells.
function selectKth(values: Float64Array, k: number): number {
  let left = 0
  let right = values.length - 1

  while (left < right) {
    const pivot = values[(left + right) >> 1] ?? 0
    let i = left
    let j = right

    while (i <= j) {
      while ((values[i] ?? 0) < pivot) i += 1
      while ((values[j] ?? 0) > pivot) j -= 1

      if (i <= j) {
        const swap = values[i] ?? 0
        values[i] = values[j] ?? 0
        values[j] = swap
        i += 1
        j -= 1
      }
    }

    if (k <= j) right = j
    else if (k >= i) left = i
    else break
  }

  return values[k] ?? 0
}

// The score at the middle of the gradient, which is drawn by the square root
// of each score's share of the range.
export function geneScaleMidpoint({ min, max }: GeneScaleBounds): number {
  return min + (max - min) / 4
}

// `geneRange=` in a link: "min,max", either end empty for Auto. Auto is ","
// so a link can turn a dataset manifest's range back to Auto.
export function formatGeneScaleRange(range: GeneScaleRange): string {
  return `${range.min === null ? '' : String(range.min)},${range.max === null ? '' : String(range.max)}`
}

export function parseGeneScaleRange(
  value: string | undefined,
): GeneScaleRange | undefined {
  if (value === undefined) return undefined

  const parts = value.split(',')
  if (parts.length !== 2) return undefined

  const [min, max] = parts.map((part) => {
    const trimmed = part.trim()
    if (trimmed === '') return null
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : undefined
  })

  if (min === undefined || max === undefined) return undefined
  if (min !== null && max !== null && max <= min) return undefined

  return { min, max }
}
