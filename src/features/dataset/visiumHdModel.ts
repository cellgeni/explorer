import type { VisiumHdBinSizeMicrometers } from '../../datasets/visiumHdDataset'

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

export function createVisiumHdBinOptions(
  availableBinSizes: readonly VisiumHdBinSizeMicrometers[],
  binCounts: Readonly<Partial<Record<VisiumHdBinSizeMicrometers, number>>> = {},
): readonly VisiumHdBinOption[] {
  const available = new Set(availableBinSizes)

  return VISIUM_HD_BIN_OPTION_ORDER.map((size) => {
    const isAvailable = available.has(size)
    const disabled = !isAvailable
    const reason = !isAvailable ? `${size} µm binned output was not detected.` : undefined

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

export function visiumHdBinSizeLabel(size: VisiumHdBinSizeMicrometers): string {
  return `${size} µm`
}
