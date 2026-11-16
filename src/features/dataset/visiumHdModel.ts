import type {
  VisiumHdBinnedOverview,
  VisiumHdBinSizeMicrometers,
} from '../../datasets/visiumHdDataset'

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
      // The tier drawn, when it is not the selected one: a coarser view of
      // zoomed-out 2 µm bins, or the old tier while the selected one loads.
      readonly loadedBinSize?: VisiumHdBinSizeMicrometers
      readonly options: readonly VisiumHdBinOption[]
      // Bins in the drawn tier.
      readonly binCount?: number
      readonly error?: string
    }

export const IDLE_VISIUM_HD_CONTROL_STATE: VisiumHdControlState = { status: 'idle' }

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

// The drawn tier stays on screen until the selected one is ready, so the
// loading state keeps its size beside its bin count.
export function visiumHdControlLoading(
  current: VisiumHdControlState,
  selectedBinSize: VisiumHdBinSizeMicrometers,
): VisiumHdControlState {
  if (current.status === 'idle') {
    return current
  }

  const { loadedBinSize, ...rest } = current
  const drawnBinSize = loadedBinSize ?? current.selectedBinSize

  return {
    ...rest,
    status: 'loading',
    selectedBinSize,
    ...(drawnBinSize === selectedBinSize ? {} : { loadedBinSize: drawnBinSize }),
  }
}

export function visiumHdControlReadyFromOptions(
  url: string,
  options: readonly VisiumHdBinOption[],
  overview: VisiumHdBinnedOverview,
  selectedBinSize: VisiumHdBinSizeMicrometers = overview.binSizeMicrometers,
): VisiumHdControlState {
  return {
    status: 'ready',
    url,
    selectedBinSize,
    ...(overview.binSizeMicrometers === selectedBinSize
      ? {}
      : { loadedBinSize: overview.binSizeMicrometers }),
    options: updateVisiumHdBinOptionCount(
      options,
      overview.binSizeMicrometers,
      overview.gridCells.ids.length,
    ),
    binCount: overview.gridCells.ids.length,
  }
}

export function visiumHdControlStateFromOverview(
  url: string,
  availableBinSizes: readonly VisiumHdBinSizeMicrometers[],
  overview: VisiumHdBinnedOverview,
): VisiumHdControlState {
  return visiumHdControlReadyFromOptions(
    url,
    createVisiumHdBinOptions(availableBinSizes, {
      [overview.binSizeMicrometers]: overview.gridCells.ids.length,
    }),
    overview,
  )
}

export function visiumHdControlFailed(
  current: VisiumHdControlState,
  error: string,
): VisiumHdControlState {
  return current.status === 'idle'
    ? current
    : {
        ...current,
        status: 'error',
        error,
      }
}

// The tier that bin reads use: selected-gene expression, ROI, Magic Lens and
// the Bin card. A failed switch keeps the old tier drawn with the failed size
// selected, so reads follow the drawn tier until the next switch. While a tier
// loads they use the selected size: a switch has cleared the old expression and
// selected bin, and zooming in with 2 µm selected loads its bins in this state
// over the 16 µm view, where the drawn tier would swap reads to 16 µm and back.
export function visiumHdActiveBinSize(
  state: VisiumHdControlState,
): VisiumHdBinSizeMicrometers | undefined {
  if (state.status === 'idle') {
    return undefined
  }

  return state.status === 'error'
    ? (state.loadedBinSize ?? state.selectedBinSize)
    : state.selectedBinSize
}

export function visiumHdBinSizeLabel(size: VisiumHdBinSizeMicrometers): string {
  return `${size} µm`
}
