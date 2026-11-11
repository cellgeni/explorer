// The units the interface shows (UNIFIED_PLAN.md, 15.1-K): micrometres and
// square micrometres, written with the micro sign (U+00B5) everywhere, never
// "um", "um2" or "um^2".
export const MICROMETERS = 'µm'
export const SQUARE_MICROMETERS = 'µm²'

// "9.3 µm" from an already formatted number.
export function withMicrometers(value: string): string {
  return `${value} ${MICROMETERS}`
}

// "68.3 µm²" from an already formatted number.
export function withSquareMicrometers(value: string): string {
  return `${value} ${SQUARE_MICROMETERS}`
}

// "943,210 µm²": whole numbers once an area is large, so the figure stays
// short, and a decimal or two below that.
export function formatSquareMicrometers(value: number): string {
  const digits = value < 10 ? 2 : value < 1_000 ? 1 : 0
  return withSquareMicrometers(
    value.toLocaleString(undefined, { maximumFractionDigits: digits }),
  )
}
