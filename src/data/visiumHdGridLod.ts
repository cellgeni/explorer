import type { VisiumHdBinSizeMicrometers } from '../datasets/visiumHdDataset'

export const VISIUM_HD_2UM_EXACT_GRID_ZOOM_MIN = 3

export function visiumHdGridLoadBinSize(
  selectedBinSize: VisiumHdBinSizeMicrometers,
  zoom: number | undefined,
  availableBinSizes: readonly VisiumHdBinSizeMicrometers[],
): VisiumHdBinSizeMicrometers {
  if (
    selectedBinSize === 2 &&
    (zoom === undefined || zoom < VISIUM_HD_2UM_EXACT_GRID_ZOOM_MIN) &&
    availableBinSizes.includes(16)
  ) {
    return 16
  }

  return selectedBinSize
}

export function visiumHdAvailableBinSizes(
  options: readonly {
    readonly size: VisiumHdBinSizeMicrometers
    readonly disabled: boolean
  }[],
): readonly VisiumHdBinSizeMicrometers[] {
  return options.filter((option) => !option.disabled).map((option) => option.size)
}
