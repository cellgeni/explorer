import { useId } from 'react'

// Label IDs for the panels that still take them. The section blocks
// (15.2-A) make their own; these go when the cards replace the Cell, ROI and
// Magic Lens tabs (15.2-D).
export interface AppControlIds {
  readonly embeddingViewInputId: string
  readonly roiNameInputId: string
  readonly magicLensScopeInputId: string
  readonly magicLensRadiusInputId: string
  readonly magicLensMinQvInputId: string
}

export function useAppControlIds(): AppControlIds {
  return {
    embeddingViewInputId: useId(),
    roiNameInputId: useId(),
    magicLensScopeInputId: useId(),
    magicLensRadiusInputId: useId(),
    magicLensMinQvInputId: useId(),
  }
}
