// The 2 µm tier's bins come from its filtered matrix's barcodes, which encode
// each bin's row and column, rather than from its tissue_positions.parquet:
// over 11 million rows on the reference dataset, most out of tissue.
export function visiumHdFilteredBarcodesPath(outputPath: string): string {
  return `${outputPath}/filtered_feature_bc_matrix/barcodes.tsv.gz`
}

// The files a tier needs: its bins' positions (for 2 µm, its barcodes), its
// scalefactors and its filtered matrix.
export function visiumHdRequiredBinPaths(bin: {
  readonly binSizeMicrometers: number
  readonly outputPath: string
  readonly tissuePositionsPath: string
  readonly scalefactorsPath: string
  readonly filteredMatrixH5Path: string
}): readonly [string, string, string] {
  return [
    bin.binSizeMicrometers === 2
      ? visiumHdFilteredBarcodesPath(bin.outputPath)
      : bin.tissuePositionsPath,
    bin.scalefactorsPath,
    bin.filteredMatrixH5Path,
  ]
}

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

export function normalizeVisiumHdBarcodeMappingRowBudget(value: number): number {
  if (!Number.isFinite(value) || value < 1) {
    throw new RangeError(
      `Barcode mapping row budget must be a positive finite number, received ${value}.`,
    )
  }

  return Math.floor(value)
}
