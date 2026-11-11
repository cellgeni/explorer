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
