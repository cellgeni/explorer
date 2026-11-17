import { useEffect, useMemo, useRef, useState } from 'react'
import type { RoiSelection } from '../../data/roiSelection'
import { ROI_CELL_EXPORT_LIMIT } from '../../data/roiCells'
import type { RoiCellsLoader } from '../app-shell/appDependencies'
import type { AppendDebugEvent } from '../app-shell/appRuntimeModel'
import type { SavedSelection } from '../roi/selectionListModel'
import type { PlotSavedSelection, PlotSelectionCells } from './plotsPanelModel'

// The cells of each saved selection, for Group by › Selections. Each outline
// is looked up once per dataset, as the Selection card looks up the active
// one; renaming or recolouring keeps the outline, so it reads nothing again.

interface SelectionCellsResults {
  readonly url: string | null
  readonly cells: ReadonlyMap<RoiSelection, PlotSelectionCells>
}

const LOADING: PlotSelectionCells = { status: 'loading' }

export function useSelectionCells({
  enabled,
  datasetUrl,
  selections,
  loadCells,
  appendDebugEvent,
}: {
  // Group by › Selections is shown, so the cells are needed.
  readonly enabled: boolean
  readonly datasetUrl: string | null
  readonly selections: readonly SavedSelection[]
  readonly loadCells: RoiCellsLoader
  readonly appendDebugEvent: AppendDebugEvent
}): readonly PlotSavedSelection[] {
  const [results, setResults] = useState<SelectionCellsResults>({
    url: null,
    cells: new Map(),
  })
  // Lookups in flight, kept across renders so a rename does not restart one.
  const inFlightRef = useRef(new Map<RoiSelection, AbortController>())

  // Another dataset stops the lookups for this one.
  useEffect(() => {
    const inFlight = inFlightRef.current

    return () => {
      for (const controller of inFlight.values()) controller.abort()
      inFlight.clear()
    }
  }, [datasetUrl])

  useEffect(() => {
    if (!enabled || datasetUrl === null) return

    const inFlight = inFlightRef.current
    const known = results.url === datasetUrl ? results.cells : null

    for (const saved of selections) {
      const selection = saved.selection
      if (known?.has(selection) === true || inFlight.has(selection)) continue

      const controller = new AbortController()
      inFlight.set(selection, controller)

      const settle = (cells: PlotSelectionCells) => {
        if (inFlight.get(selection) !== controller) return
        inFlight.delete(selection)
        setResults((current) => ({
          url: datasetUrl,
          cells: new Map(current.url === datasetUrl ? current.cells : []).set(
            selection,
            cells,
          ),
        }))
      }

      loadCells(datasetUrl, selection, { signal: controller.signal }).then(
        (cells) => {
          settle({
            status: 'ready',
            cellIds: cells.map((cell) => cell.id),
            hitCellLimit: cells.length >= ROI_CELL_EXPORT_LIMIT,
          })
          appendDebugEvent(
            `Plots: ${saved.name} holds ${cells.length.toLocaleString()} cells`,
          )
        },
        (error: unknown) => {
          if (controller.signal.aborted) return
          const message = error instanceof Error ? error.message : String(error)
          settle({ status: 'error', message })
          appendDebugEvent(`Plots: cells of ${saved.name} failed: ${message}`)
        },
      )
    }
  }, [appendDebugEvent, datasetUrl, enabled, loadCells, results, selections])

  return useMemo(
    () =>
      selections.map((saved) => ({
        id: saved.id,
        name: saved.name,
        color: saved.color,
        visible: saved.visible,
        cells:
          (results.url === datasetUrl ? results.cells.get(saved.selection) : undefined) ??
          LOADING,
      })),
    [datasetUrl, results, selections],
  )
}
