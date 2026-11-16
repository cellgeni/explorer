// The Gene scale's range (Cells › Cell color). An end left null follows the
// data: 0 at the bottom, the 99th percentile of the scores at the top. Kept
// across genes and datasets until set back to Auto, so sections and genes
// compare on one scale.
export interface GeneScaleRange {
  readonly min: number | null
  // A score, a percentile of each dataset's scores, or null for Auto.
  readonly max: number | GeneScalePercentile | null
}

// A top that follows the data like Auto, at another percentile of the scores
// above 0: `p95` in links and manifests.
export interface GeneScalePercentile {
  readonly percentile: number
}

export interface GeneScaleBounds {
  readonly min: number
  readonly max: number
}

export const AUTO_GENE_SCALE_RANGE: GeneScaleRange = { min: null, max: null }

// Auto puts the top of the scale at this percentile of the scores above 0,
// not at the highest score, so a few outlier cells do not squeeze the rest
// into the bottom colours. Cells above it get the top colour.
export const AUTO_GENE_SCALE_PERCENTILE = 99

export function isAutoGeneScaleRange(range: GeneScaleRange): boolean {
  return range.min === null && range.max === null
}

// The percentile the top follows, unless it is a fixed score.
export function geneScalePercentile(range: GeneScaleRange): number {
  return range.max !== null && typeof range.max === 'object'
    ? range.max.percentile
    : AUTO_GENE_SCALE_PERCENTILE
}

// `autoTop` is the data's top at the range's percentile.
export function geneScaleBounds(range: GeneScaleRange, autoTop: number): GeneScaleBounds {
  return { min: range.min ?? 0, max: typeof range.max === 'number' ? range.max : autoTop }
}

// "95th", "99.5th", "1st".
export function formatPercentile(percentile: number): string {
  const lastTwo = percentile % 100
  const last = percentile % 10
  const suffix =
    !Number.isInteger(percentile) || (lastTwo >= 11 && lastTwo <= 13)
      ? 'th'
      : last === 1
        ? 'st'
        : last === 2
          ? 'nd'
          : last === 3
            ? 'rd'
            : 'th'

  return `${percentile}${suffix}`
}

export interface GeneScoreSpread {
  // The percentile asked for.
  readonly top: number
  readonly highest: number
}

export const EMPTY_GENE_SCORE_SPREAD: GeneScoreSpread = { top: 0, highest: 0 }

// A percentile and the highest of `scores`. The percentile is by nearest rank
// over the scores above 0: zeros would put it at 0 for a gene that few cells
// express. It is a score some cell has; the 99th is the highest with 100 or
// fewer.
export function geneScoreSpread(
  scores: ArrayLike<number>,
  percentile: number = AUTO_GENE_SCALE_PERCENTILE,
): GeneScoreSpread {
  let count = 0
  let highest = 0

  for (let index = 0; index < scores.length; index += 1) {
    const score = scores[index] ?? 0

    if (score > 0) {
      count += 1
      highest = Math.max(highest, score)
    }
  }

  if (count === 0) return EMPTY_GENE_SCORE_SPREAD

  const positive = new Float64Array(count)
  let filled = 0

  for (let index = 0; index < scores.length; index += 1) {
    const score = scores[index] ?? 0

    if (score > 0) {
      positive[filled] = score
      filled += 1
    }
  }

  const rank = Math.max(1, Math.ceil((percentile / 100) * count))

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

// `geneRange=` in a link: "min,max", either end empty for Auto, the top
// possibly a percentile ("p95"). Auto is "," so a link can turn a dataset
// manifest's range back to Auto.
export function formatGeneScaleRange(range: GeneScaleRange): string {
  const max =
    range.max === null
      ? ''
      : typeof range.max === 'number'
        ? String(range.max)
        : `p${range.max.percentile}`

  return `${range.min === null ? '' : String(range.min)},${max}`
}

export function parseGeneScaleRange(
  value: string | undefined,
): GeneScaleRange | undefined {
  if (value === undefined) return undefined

  const parts = value.split(',')
  if (parts.length !== 2) return undefined

  const [minPart = '', maxPart = ''] = parts
  const min = parseGeneScaleScore(minPart)
  const max = parseGeneScalePercentile(maxPart) ?? parseGeneScaleScore(maxPart)

  if (min === undefined || max === undefined) return undefined
  if (typeof min === 'number' && typeof max === 'number' && max <= min) return undefined

  return { min, max }
}

// "p95": above 0, up to 100.
export function parseGeneScalePercentile(value: string): GeneScalePercentile | undefined {
  const match = /^p(\d+(?:\.\d+)?)$/.exec(value.trim())
  const percentile = match === null ? Number.NaN : Number(match[1])

  return percentile > 0 && percentile <= 100 ? { percentile } : undefined
}

// A score, null for an empty (Auto) end, or undefined when it is neither.
function parseGeneScaleScore(value: string): number | null | undefined {
  const trimmed = value.trim()
  if (trimmed === '') return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}
