export const VISIUM_HD_TWO_MICROMETER_STRATEGY_REASON =
  '2 µm requires a budgeted loader from filtered matrix barcodes or viewport tiles; loading all tissue_positions rows for first paint is disabled.'

export class VisiumHdTwoMicrometerOverviewDisabledError extends Error {
  override readonly name = 'VisiumHdTwoMicrometerOverviewDisabledError'
}

export class VisiumHdFilteredBarcodeBudgetExceededError extends Error {
  override readonly name = 'VisiumHdFilteredBarcodeBudgetExceededError'

  constructor(
    readonly binSizeMicrometers: number,
    readonly barcodeCount: number,
    readonly maxBarcodeCount: number,
  ) {
    super(
      `Visium HD ${binSizeMicrometers} µm filtered barcode count exceeded the interactive budget of ${maxBarcodeCount.toLocaleString()} barcodes.`,
    )
  }
}

export function normalizeVisiumHdTwoMicrometerFilteredBarcodeBudget(
  value: number | undefined,
): number | undefined {
  if (value === undefined) {
    return undefined
  }

  if (!Number.isFinite(value) || value < 1) {
    throw new RangeError(
      `2 µm filtered barcode budget must be a positive finite number, received ${value}.`,
    )
  }

  return Math.floor(value)
}

export function hasVisiumHdTwoMicrometerFilteredBarcodeBudget(
  value: number | undefined,
): value is number {
  return value !== undefined && Number.isFinite(value) && Math.floor(value) >= 1
}
