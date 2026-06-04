import type { BBox, DataPoint } from './coords'
import type { Selection } from './gex'

export type RoiSelection =
  | { readonly kind: 'box'; readonly bbox: BBox }
  | {
      readonly kind: 'lasso'
      readonly bbox: BBox
      readonly points: readonly DataPoint[]
    }

export type RoiSelectionInput = BBox | RoiSelection

export function normalizeRoiSelection(input: RoiSelectionInput): RoiSelection {
  return isRoiSelection(input) ? input : { kind: 'box', bbox: input }
}

export function roiSelectionToSpatialSelection(
  selection: RoiSelection,
): Selection | null {
  return selection.kind === 'lasso'
    ? { kind: 'polygon', points: selection.points }
    : null
}

export function isRoiSelection(input: RoiSelectionInput): input is RoiSelection {
  return 'kind' in input
}
