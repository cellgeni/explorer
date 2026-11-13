import type { ViewerSelectionOutline } from '../../components/viewerCoreTypes'
import type { RoiSelection } from '../../data/roiSelection'
import { defaultRoiName } from './roiModel'

// Saved selections (plan 15.4-A). Each box or lasso drawn on a
// dataset with cells, spots or bins is kept with a name, a colour and a
// visibility. Drawing adds one and makes it active; the Selection card shows
// the active one, and the Annotations section lists them all.
export interface SavedSelection {
  readonly id: string
  readonly name: string
  readonly color: string
  readonly visible: boolean
  readonly selection: RoiSelection
}

export interface SelectionListState {
  // The dataset (and Visium library) the selections were drawn on. Another
  // one starts empty.
  readonly datasetKey: string | null
  readonly selections: readonly SavedSelection[]
  // The selection the card shows. The card's queries live in the ROI
  // workflow; this only says which selection they are for.
  readonly activeId: string | null
  // Numbers the next default name ("ROI 3") and id.
  readonly nextNumber: number
}

// Bright enough to read on the dark canvas, with the halo for H&E. The
// first is the overlay selection colour, so one selection looks as before.
export const SELECTION_PALETTE = [
  '#f0c84b',
  '#4bd6f0',
  '#f04bc8',
  '#7be36b',
  '#f08a4b',
  '#a98bf5',
  '#4b8df0',
  '#f05b5b',
] as const

export const EMPTY_SELECTION_LIST: SelectionListState = {
  datasetKey: null,
  selections: [],
  activeId: null,
  nextNumber: 1,
}

// What the selections belong to: the ready dataset, and the frame its
// coordinates are in (a Visium library, a SpatialData coordinate system and
// scale). Null while no dataset is ready.
export function selectionDatasetKey(
  datasetUrl: string | null,
  view: { readonly visiumLibrary?: string; readonly spatialDataFrame?: string } = {},
): string | null {
  if (datasetUrl === null) return null

  const parts = [
    ...(view.visiumLibrary === undefined ? [] : [`library=${view.visiumLibrary}`]),
    ...(view.spatialDataFrame === undefined ? [] : [`frame=${view.spatialDataFrame}`]),
  ]
  return parts.length === 0 ? datasetUrl : `${datasetUrl}#${parts.join('&')}`
}

export function selectionPaletteColor(index: number): string {
  return SELECTION_PALETTE[index % SELECTION_PALETTE.length] ?? SELECTION_PALETTE[0]
}

// The list for this dataset: the state if it was drawn on it, else empty.
export function selectionListFor(
  state: SelectionListState,
  datasetKey: string | null,
): SelectionListState {
  return state.datasetKey === datasetKey ? state : { ...EMPTY_SELECTION_LIST, datasetKey }
}

// A blank name shows as "Selection", as the card's title does.
export function selectionDisplayName(selection: Pick<SavedSelection, 'name'>): string {
  const name = selection.name.trim()
  return name === '' ? 'Selection' : name
}

export function addSelection(
  state: SelectionListState,
  selection: RoiSelection,
  name?: string,
): { readonly state: SelectionListState; readonly added: SavedSelection } {
  const number = state.nextNumber
  const added: SavedSelection = {
    id: `selection-${number.toLocaleString('en-US', { useGrouping: false })}`,
    name: name ?? defaultRoiName(number),
    color: selectionPaletteColor(state.selections.length),
    visible: true,
    selection,
  }

  return {
    state: {
      ...state,
      selections: [...state.selections, added],
      activeId: added.id,
      nextNumber: number + 1,
    },
    added,
  }
}

function updateSelection(
  state: SelectionListState,
  id: string,
  update: (selection: SavedSelection) => SavedSelection,
): SelectionListState {
  let changed = false
  const selections = state.selections.map((selection) => {
    if (selection.id !== id) return selection
    const next = update(selection)
    if (next !== selection) changed = true
    return next
  })

  return changed ? { ...state, selections } : state
}

export function renameSelection(
  state: SelectionListState,
  id: string,
  name: string,
): SelectionListState {
  return updateSelection(state, id, (selection) =>
    selection.name === name ? selection : { ...selection, name },
  )
}

export function recolorSelection(
  state: SelectionListState,
  id: string,
  color: string,
): SelectionListState {
  return updateSelection(state, id, (selection) =>
    selection.color === color ? selection : { ...selection, color },
  )
}

export function setSelectionVisible(
  state: SelectionListState,
  id: string,
  visible: boolean,
): SelectionListState {
  return updateSelection(state, id, (selection) =>
    selection.visible === visible ? selection : { ...selection, visible },
  )
}

export function activateSelection(
  state: SelectionListState,
  id: string | null,
): SelectionListState {
  if (state.activeId === id) return state
  if (id !== null && !state.selections.some((selection) => selection.id === id)) {
    return state
  }

  return { ...state, activeId: id }
}

export interface RemovedSelection {
  readonly selection: SavedSelection
  readonly index: number
  readonly wasActive: boolean
}

export function removeSelection(
  state: SelectionListState,
  id: string,
): { readonly state: SelectionListState; readonly removed: RemovedSelection | null } {
  const index = state.selections.findIndex((selection) => selection.id === id)
  const selection = state.selections[index]

  if (selection === undefined) return { state, removed: null }

  const wasActive = state.activeId === id

  return {
    state: {
      ...state,
      selections: state.selections.filter((candidate) => candidate.id !== id),
      activeId: wasActive ? null : state.activeId,
    },
    removed: { selection, index, wasActive },
  }
}

// Undo puts a deleted selection back where it was. Selections drawn since
// stay, so nothing later is lost.
export function restoreSelection(
  state: SelectionListState,
  removed: RemovedSelection,
): SelectionListState {
  if (state.selections.some((selection) => selection.id === removed.selection.id)) {
    return state
  }

  const index = Math.min(removed.index, state.selections.length)

  return {
    ...state,
    selections: [
      ...state.selections.slice(0, index),
      removed.selection,
      ...state.selections.slice(index),
    ],
  }
}

// Outlines drawn over the canvas: visible selections, and the active one
// even when hidden, since its card is open.
export type SelectionOutline = ViewerSelectionOutline

export function selectionOutlines(
  selections: readonly SavedSelection[],
  activeId: string | null,
  showInactive: boolean,
): readonly SelectionOutline[] {
  return selections
    .filter((selection) =>
      selection.id === activeId ? true : showInactive && selection.visible,
    )
    .map((selection) => ({
      id: selection.id,
      color: selection.color,
      active: selection.id === activeId,
      selection: selection.selection,
    }))
}

// The saved selection with this outline, so a replayed `roi=` (a Visium
// view reload) shows it again instead of adding a copy. The link rounds
// coordinates to 0.001, so they match within that.
export function findSelectionByGeometry(
  selections: readonly SavedSelection[],
  selection: RoiSelection,
): SavedSelection | undefined {
  return selections.find((candidate) => sameGeometry(candidate.selection, selection))
}

const GEOMETRY_TOLERANCE = 1e-3

function near(a: number, b: number): boolean {
  return Math.abs(a - b) <= GEOMETRY_TOLERANCE
}

function sameGeometry(first: RoiSelection, second: RoiSelection): boolean {
  if (first.kind !== second.kind) return false

  const a = first.bbox
  const b = second.bbox
  if (
    !near(a.minX, b.minX) ||
    !near(a.minY, b.minY) ||
    !near(a.maxX, b.maxX) ||
    !near(a.maxY, b.maxY)
  ) {
    return false
  }

  if (first.kind === 'box' || second.kind === 'box') return true

  return (
    first.points.length === second.points.length &&
    first.points.every((point, index) => {
      const other = second.points[index]
      return other !== undefined && near(point.x, other.x) && near(point.y, other.y)
    })
  )
}

export function selectionKindLabel(selection: RoiSelection): string {
  return selection.kind === 'lasso' ? 'Lasso' : 'Box'
}
