import type { VisiumHdBinSizeMicrometers } from '../../datasets/visiumHdDataset'
import { normalizeVisiumHdBarcodeMappingRowBudget } from '../../datasets/visiumHdBarcodeMappings'
import {
  VISIUM_HD_TWO_MICROMETER_STRATEGY_REASON,
  hasVisiumHdTwoMicrometerFilteredBarcodeBudget,
  normalizeVisiumHdTwoMicrometerFilteredBarcodeBudget,
} from '../../datasets/visiumHdStrategy'

export interface VisiumHdBinOption {
  readonly size: VisiumHdBinSizeMicrometers
  readonly available: boolean
  readonly disabled: boolean
  readonly reason?: string
  readonly binCount?: number
}

export type VisiumHdControlState =
  | { readonly status: 'idle' }
  | {
      readonly status: 'ready' | 'loading' | 'error'
      readonly url: string
      readonly selectedBinSize: VisiumHdBinSizeMicrometers
      readonly options: readonly VisiumHdBinOption[]
      readonly binCount?: number
      readonly error?: string
    }

const VISIUM_HD_BIN_OPTION_ORDER: readonly VisiumHdBinSizeMicrometers[] = [16, 8, 2]
export const VISIUM_HD_TWO_MICROMETER_BUDGET_INPUT_MIN = 1
export const VISIUM_HD_BARCODE_MAPPING_BUDGET_INPUT_MIN = 1

export interface CreateVisiumHdBinOptionsOptions {
  readonly twoMicrometerFilteredBarcodeBudget?: number
}

export function createVisiumHdBinOptions(
  availableBinSizes: readonly VisiumHdBinSizeMicrometers[],
  binCounts: Readonly<Partial<Record<VisiumHdBinSizeMicrometers, number>>> = {},
  options: CreateVisiumHdBinOptionsOptions = {},
): readonly VisiumHdBinOption[] {
  const available = new Set(availableBinSizes)
  const twoMicrometerBudgetEnabled = hasVisiumHdTwoMicrometerFilteredBarcodeBudget(
    options.twoMicrometerFilteredBarcodeBudget,
  )

  return VISIUM_HD_BIN_OPTION_ORDER.map((size) => {
    const isAvailable = available.has(size)
    const disabled = !isAvailable || (size === 2 && !twoMicrometerBudgetEnabled)
    const reason = !isAvailable
      ? `${size} µm binned output was not detected.`
      : size === 2 && !twoMicrometerBudgetEnabled
        ? VISIUM_HD_TWO_MICROMETER_STRATEGY_REASON
        : undefined

    return {
      size,
      available: isAvailable,
      disabled,
      ...(reason === undefined ? {} : { reason }),
      ...(binCounts[size] === undefined ? {} : { binCount: binCounts[size] }),
    }
  })
}

export function updateVisiumHdBinOptionCount(
  options: readonly VisiumHdBinOption[],
  binSize: VisiumHdBinSizeMicrometers,
  binCount: number,
): readonly VisiumHdBinOption[] {
  return options.map((option) =>
    option.size === binSize ? { ...option, binCount } : option,
  )
}

export function updateVisiumHdBinOptionsForTwoMicrometerBudget(
  options: readonly VisiumHdBinOption[],
  twoMicrometerFilteredBarcodeBudget: number | undefined,
): readonly VisiumHdBinOption[] {
  const availableBinSizes = options
    .filter((option) => option.available)
    .map((option) => option.size)
  const binCounts: Partial<Record<VisiumHdBinSizeMicrometers, number>> = {}

  for (const option of options) {
    if (option.binCount !== undefined) {
      binCounts[option.size] = option.binCount
    }
  }

  return createVisiumHdBinOptions(
    availableBinSizes,
    binCounts,
    twoMicrometerFilteredBarcodeBudget === undefined
      ? {}
      : { twoMicrometerFilteredBarcodeBudget },
  )
}

export function visiumHdBinSizeLabel(size: VisiumHdBinSizeMicrometers): string {
  return `${size} µm`
}

export function parseVisiumHdTwoMicrometerBudgetInput(value: string): number | undefined {
  const trimmedValue = value.trim()

  if (trimmedValue === '') {
    return undefined
  }

  const numericValue = Number(trimmedValue)

  if (
    !Number.isFinite(numericValue) ||
    numericValue < VISIUM_HD_TWO_MICROMETER_BUDGET_INPUT_MIN
  ) {
    return undefined
  }

  return normalizeVisiumHdTwoMicrometerFilteredBarcodeBudget(numericValue)
}

export function parseVisiumHdBarcodeMappingBudgetInput(
  value: string,
): number | undefined {
  const trimmedValue = value.trim()

  if (trimmedValue === '') {
    return undefined
  }

  const numericValue = Number(trimmedValue)

  if (
    !Number.isFinite(numericValue) ||
    numericValue < VISIUM_HD_BARCODE_MAPPING_BUDGET_INPUT_MIN
  ) {
    return undefined
  }

  return normalizeVisiumHdBarcodeMappingRowBudget(numericValue)
}
