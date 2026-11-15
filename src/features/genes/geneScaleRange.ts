// The Gene scale's range (Cells › Cell color). An end left null follows the
// data: 0 at the bottom, the highest score at the top. Kept across genes and
// datasets until set back to Auto, so sections and genes compare on one scale.
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

// The score at the middle of the gradient, which is drawn by the square root
// of each score's share of the range.
export function geneScaleMidpoint({ min, max }: GeneScaleBounds): number {
  return min + (max - min) / 4
}

// `geneRange=` in a link: "min,max", either end empty for Auto.
export function formatGeneScaleRange(range: GeneScaleRange): string | undefined {
  if (isAutoGeneScaleRange(range)) return undefined

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
