import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BBox } from '../../data/coords'
import type { RoiSelection } from '../../data/roiSelection'
import type { AppendDebugEvent } from '../app-shell/appRuntimeModel'
import type { UndoOffer } from '../app-shell/useUndoToast'
import {
  EMPTY_SELECTION_LIST,
  activateSelection,
  addSelection,
  findSelectionByGeometry,
  recolorSelection,
  removeSelection,
  renameSelection,
  restoreSelection,
  selectionDisplayName,
  selectionListFor,
  setSelectionVisible,
  type SavedSelection,
  type SelectionListState,
} from './selectionListModel'

interface MutableRef<T> {
  current: T
}

export interface SelectionListInput {
  // The ready dataset (and Visium library); the list belongs to it.
  readonly datasetKey: string | null
  // False on an image, where drawing makes GeoJSON shapes instead.
  readonly enabled: boolean
  // Whether ROI drawing is allowed now (canDrawRoi). A link's ROI waits for
  // it; drawing and choosing do not, as the ROI workflows check what they
  // need themselves.
  readonly canRun: boolean
  // The ROI the workflow holds: the active selection's, or null once it is
  // cleared or cancelled.
  readonly activeSelection: RoiSelection | null
  // A link's `roi=`, added as "Shared ROI" once the dataset can run it.
  // A saved selection with the same outline is shown instead.
  readonly initialSharedSelectionRef: MutableRef<RoiSelection | null>
  // The platform's ROI handler: reads the selection's cells or bins and
  // genes into the card.
  readonly runSelection: (selection: RoiSelection) => void
  // Clears the card's ROI state.
  readonly clearActiveSelection: () => void
  // The ROI workflows name exports and the card after this.
  readonly setRoiName: (name: string) => void
  readonly offerUndo: (offer: UndoOffer) => void
  readonly appendDebugEvent: AppendDebugEvent
  readonly zoomToBbox: (bbox: BBox) => void
}

export interface SelectionList {
  readonly selections: readonly SavedSelection[]
  // The selection the card shows, while its ROI is held.
  readonly activeId: string | null
  readonly active: SavedSelection | null
  readonly canActivate: boolean
  // Drawing adds a selection and makes it active.
  readonly onDrawn: (selection: RoiSelection) => void
  readonly onActivate: (id: string) => void
  // Closing the card keeps the selection in the list.
  readonly onCloseActive: () => void
  readonly onRename: (id: string, name: string) => void
  readonly onColorChange: (id: string, color: string) => void
  readonly onVisibilityChange: (id: string, visible: boolean) => void
  // Offers Undo.
  readonly onDelete: (id: string) => void
  readonly onGoTo: (id: string) => void
}

export function useSelectionList({
  datasetKey,
  enabled,
  canRun,
  activeSelection,
  initialSharedSelectionRef,
  runSelection,
  clearActiveSelection,
  setRoiName,
  offerUndo,
  appendDebugEvent,
  zoomToBbox,
}: SelectionListInput): SelectionList {
  const [state, setState] = useState<SelectionListState>(EMPTY_SELECTION_LIST)
  // Another dataset (or Visium library, SpatialData view) starts empty, and
  // so does coming back to one. While a load runs the key is null and the
  // list is kept, so a reload of the same view keeps it.
  if (datasetKey !== null && state.datasetKey !== datasetKey) {
    setState(selectionListFor(EMPTY_SELECTION_LIST, datasetKey))
  }
  const list = selectionListFor(state, datasetKey)
  const activeId = activeSelection === null ? null : list.activeId
  const active = useMemo(
    () => list.selections.find((selection) => selection.id === activeId) ?? null,
    [activeId, list.selections],
  )
  const canActivate = enabled && datasetKey !== null

  // Undo runs later; it reads the list and the active selection then.
  const latestRef = useRef({ list, activeId, canActivate, runSelection, setRoiName })
  useEffect(() => {
    latestRef.current = { list, activeId, canActivate, runSelection, setRoiName }
  })

  const update = useCallback(
    (change: (current: SelectionListState) => SelectionListState) => {
      setState((current) => change(selectionListFor(current, datasetKey)))
    },
    [datasetKey],
  )

  const add = useCallback(
    (selection: RoiSelection, name?: string) => {
      const { state: next, added } = addSelection(list, selection, name)
      setState(next)
      setRoiName(added.name)
      runSelection(selection)
      appendDebugEvent(`Added selection ${selectionDisplayName(added)}`)
    },
    [appendDebugEvent, list, runSelection, setRoiName],
  )

  const onDrawn = useCallback(
    (selection: RoiSelection) => {
      if (!canActivate) return
      add(selection)
    },
    [add, canActivate],
  )

  useEffect(() => {
    const shared = initialSharedSelectionRef.current

    if (shared === null || !canActivate || !canRun || activeSelection !== null) return

    initialSharedSelectionRef.current = null
    const saved = findSelectionByGeometry(list.selections, shared)

    if (saved === undefined) {
      add(shared, 'Shared ROI')
      return
    }

    setState(activateSelection(list, saved.id))
    setRoiName(saved.name)
    runSelection(saved.selection)
  }, [
    activeSelection,
    add,
    canActivate,
    canRun,
    initialSharedSelectionRef,
    list,
    runSelection,
    setRoiName,
  ])

  const onActivate = useCallback(
    (id: string) => {
      const selection = list.selections.find((candidate) => candidate.id === id)
      if (selection === undefined || !canActivate || id === activeId) return

      setState(activateSelection(list, id))
      setRoiName(selection.name)
      runSelection(selection.selection)
      appendDebugEvent(`Showing selection ${selectionDisplayName(selection)}`)
    },
    [activeId, appendDebugEvent, canActivate, list, runSelection, setRoiName],
  )

  const onCloseActive = useCallback(() => {
    clearActiveSelection()
    update((current) => activateSelection(current, null))
  }, [clearActiveSelection, update])

  const onRename = useCallback(
    (id: string, name: string) => {
      update((current) => renameSelection(current, id, name))
      if (id === activeId) setRoiName(name)
    },
    [activeId, setRoiName, update],
  )

  const onColorChange = useCallback(
    (id: string, color: string) => {
      update((current) => recolorSelection(current, id, color))
      appendDebugEvent(`Selection colour ${id}`, { coalesceKey: `selection-color:${id}` })
    },
    [appendDebugEvent, update],
  )

  const onVisibilityChange = useCallback(
    (id: string, visible: boolean) => {
      update((current) => setSelectionVisible(current, id, visible))
    },
    [update],
  )

  const onDelete = useCallback(
    (id: string) => {
      const { state: next, removed } = removeSelection(list, id)
      if (removed === null) return

      const wasActive = id === activeId
      setState(next)
      if (wasActive) clearActiveSelection()

      const message = `Deleted ${selectionDisplayName(removed.selection)}`
      const key = datasetKey
      appendDebugEvent(message)
      offerUndo({
        message,
        undo: () => {
          const latest = latestRef.current
          if (latest.list.datasetKey !== key) return

          const restored = restoreSelection(latest.list, removed)
          // The card shows it again unless another selection took its place.
          if (wasActive && latest.activeId === null && latest.canActivate) {
            setState(activateSelection(restored, removed.selection.id))
            latest.setRoiName(removed.selection.name)
            latest.runSelection(removed.selection.selection)
          } else {
            setState(restored)
          }
          appendDebugEvent(`Undone: ${message}`)
        },
      })
    },
    [activeId, appendDebugEvent, clearActiveSelection, datasetKey, list, offerUndo],
  )

  const onGoTo = useCallback(
    (id: string) => {
      const selection = list.selections.find((candidate) => candidate.id === id)
      if (selection !== undefined) zoomToBbox(selection.selection.bbox)
    },
    [list.selections, zoomToBbox],
  )

  return {
    selections: list.selections,
    activeId,
    active,
    canActivate,
    onDrawn,
    onActivate,
    onCloseActive,
    onRename,
    onColorChange,
    onVisibilityChange,
    onDelete,
    onGoTo,
  }
}
