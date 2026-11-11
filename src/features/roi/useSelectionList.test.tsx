import { act, renderHook } from '@testing-library/react'
import { useCallback, useRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { micrometers } from '../../data/coords'
import type { RoiSelection } from '../../data/roiSelection'
import type { UndoOffer } from '../app-shell/useUndoToast'
import { useSelectionList } from './useSelectionList'

function box(minX: number): RoiSelection {
  return {
    kind: 'box',
    bbox: {
      minX: micrometers(minX),
      minY: micrometers(0),
      maxX: micrometers(minX + 10),
      maxY: micrometers(10),
    },
  }
}

interface HarnessOptions {
  readonly datasetKey?: string | null
  readonly canRun?: boolean
  readonly shared?: RoiSelection | null
}

// The list over a stand-in for the ROI workflow: running a selection holds
// it, clearing drops it.
function useHarness({
  datasetKey = 'https://example.test/a',
  canRun = true,
  shared = null,
}: HarnessOptions = {}) {
  const [held, setHeld] = useState<RoiSelection | null>(null)
  const [roiName, setRoiName] = useState('ROI 1')
  const [offer, setOffer] = useState<UndoOffer | null>(null)
  const sharedRef = useRef<RoiSelection | null>(shared)
  const runs = useRef<RoiSelection[]>([])
  const [zoomToBbox] = useState(() => vi.fn())
  const runSelection = useCallback((selection: RoiSelection) => {
    runs.current.push(selection)
    setHeld(selection)
  }, [])
  const clearActiveSelection = useCallback(() => {
    setHeld(null)
  }, [])

  const list = useSelectionList({
    datasetKey,
    enabled: true,
    canRun,
    activeSelection: held,
    initialSharedSelectionRef: sharedRef,
    runSelection,
    clearActiveSelection,
    setRoiName,
    offerUndo: setOffer,
    appendDebugEvent: vi.fn(),
    zoomToBbox,
  })

  return { list, held, roiName, offer, runs, sharedRef, setHeld, zoomToBbox }
}

describe('useSelectionList', () => {
  it('adds each drawing as a selection and shows the newest', () => {
    const { result } = renderHook(() => useHarness())

    act(() => {
      result.current.list.onDrawn(box(0))
    })
    act(() => {
      result.current.list.onDrawn(box(20))
    })

    expect(result.current.list.selections.map((selection) => selection.name)).toEqual([
      'ROI 1',
      'ROI 2',
    ])
    expect(result.current.list.activeId).toBe('selection-2')
    expect(result.current.list.active?.name).toBe('ROI 2')
    expect(result.current.held?.bbox.minX).toBe(20)
    expect(result.current.roiName).toBe('ROI 2')
  })

  it('reruns a listed selection when it is activated', () => {
    const { result } = renderHook(() => useHarness())

    act(() => {
      result.current.list.onDrawn(box(0))
    })
    act(() => {
      result.current.list.onDrawn(box(20))
    })
    act(() => {
      result.current.list.onActivate('selection-1')
    })

    expect(result.current.list.activeId).toBe('selection-1')
    expect(result.current.held?.bbox.minX).toBe(0)
    expect(result.current.roiName).toBe('ROI 1')
    expect(result.current.runs.current).toHaveLength(3)

    // Activating the shown selection again runs nothing.
    act(() => {
      result.current.list.onActivate('selection-1')
    })
    expect(result.current.runs.current).toHaveLength(3)
  })

  it('keeps drawings while ROI drawing is not allowed, but holds a link back', () => {
    // A Visium HD level change, or Xenium preparation, with Box still on.
    const { result } = renderHook(() => useHarness({ canRun: false, shared: box(5) }))

    expect(result.current.list.selections).toEqual([])
    act(() => {
      result.current.list.onDrawn(box(0))
    })

    expect(result.current.list.selections.map((selection) => selection.name)).toEqual([
      'ROI 1',
    ])
    expect(result.current.held?.bbox.minX).toBe(0)
    expect(result.current.sharedRef.current).not.toBeNull()
  })

  it('does nothing without a dataset', () => {
    const { result } = renderHook(() => useHarness({ datasetKey: null }))

    act(() => {
      result.current.list.onDrawn(box(0))
    })

    expect(result.current.list.selections).toEqual([])
    expect(result.current.list.canActivate).toBe(false)
  })

  it('closes the card but keeps the selection', () => {
    const { result } = renderHook(() => useHarness())

    act(() => {
      result.current.list.onDrawn(box(0))
    })
    act(() => {
      result.current.list.onCloseActive()
    })

    expect(result.current.held).toBeNull()
    expect(result.current.list.activeId).toBeNull()
    expect(result.current.list.selections).toHaveLength(1)
  })

  it('has no active selection once the workflow drops its ROI', () => {
    const { result } = renderHook(() => useHarness())

    act(() => {
      result.current.list.onDrawn(box(0))
    })
    // A cancelled cells query, or a Visium HD bin size change.
    act(() => {
      result.current.setHeld(null)
    })

    expect(result.current.list.activeId).toBeNull()
    expect(result.current.list.active).toBeNull()
  })

  it('renames the active selection and the ROI name with it', () => {
    const { result } = renderHook(() => useHarness())

    act(() => {
      result.current.list.onDrawn(box(0))
    })
    act(() => {
      result.current.list.onDrawn(box(20))
    })
    act(() => {
      result.current.list.onRename('selection-2', 'Cortex')
    })
    act(() => {
      result.current.list.onRename('selection-1', 'Medulla')
    })

    expect(result.current.list.selections.map((selection) => selection.name)).toEqual([
      'Medulla',
      'Cortex',
    ])
    expect(result.current.roiName).toBe('Cortex')
  })

  it('recolours, hides and goes to a selection', () => {
    const { result } = renderHook(() => useHarness())

    act(() => {
      result.current.list.onDrawn(box(30))
    })
    act(() => {
      result.current.list.onColorChange('selection-1', '#00ff00')
      result.current.list.onVisibilityChange('selection-1', false)
      result.current.list.onGoTo('selection-1')
    })

    expect(result.current.list.selections[0]).toMatchObject({
      color: '#00ff00',
      visible: false,
    })
    expect(result.current.zoomToBbox).toHaveBeenCalledWith(box(30).bbox)
  })

  it('deletes the active selection, and Undo shows it again', () => {
    const { result } = renderHook(() => useHarness())

    act(() => {
      result.current.list.onDrawn(box(0))
    })
    act(() => {
      result.current.list.onDrawn(box(20))
    })
    act(() => {
      result.current.list.onDelete('selection-2')
    })

    expect(result.current.list.selections.map((selection) => selection.id)).toEqual([
      'selection-1',
    ])
    expect(result.current.held).toBeNull()
    expect(result.current.offer?.message).toBe('Deleted ROI 2')

    act(() => {
      result.current.offer?.undo()
    })

    expect(result.current.list.selections.map((selection) => selection.id)).toEqual([
      'selection-1',
      'selection-2',
    ])
    expect(result.current.list.activeId).toBe('selection-2')
    expect(result.current.held?.bbox.minX).toBe(20)
    expect(result.current.roiName).toBe('ROI 2')
  })

  it('puts a deleted selection back without taking the card from a newer one', () => {
    const { result } = renderHook(() => useHarness())

    act(() => {
      result.current.list.onDrawn(box(0))
    })
    act(() => {
      result.current.list.onDelete('selection-1')
    })
    const offer = result.current.offer
    act(() => {
      result.current.list.onDrawn(box(40))
    })
    act(() => {
      offer?.undo()
    })

    expect(result.current.list.selections.map((selection) => selection.name)).toEqual([
      'ROI 1',
      'ROI 2',
    ])
    expect(result.current.list.activeId).toBe('selection-2')
    expect(result.current.held?.bbox.minX).toBe(40)
  })

  it('deletes an inactive selection without touching the card', () => {
    const { result } = renderHook(() => useHarness())

    act(() => {
      result.current.list.onDrawn(box(0))
    })
    act(() => {
      result.current.list.onDrawn(box(20))
    })
    act(() => {
      result.current.list.onDelete('selection-1')
    })

    expect(result.current.list.activeId).toBe('selection-2')
    expect(result.current.held?.bbox.minX).toBe(20)
  })

  it('starts empty for another dataset, and Undo does not reach across', () => {
    let datasetKey = 'https://example.test/a'
    const { result, rerender } = renderHook(() => useHarness({ datasetKey }))

    act(() => {
      result.current.list.onDrawn(box(0))
    })
    act(() => {
      result.current.list.onDelete('selection-1')
    })
    const offer = result.current.offer
    datasetKey = 'https://example.test/b'
    rerender()

    expect(result.current.list.selections).toEqual([])
    act(() => {
      offer?.undo()
    })
    expect(result.current.list.selections).toEqual([])
  })

  it('starts empty on coming back to a dataset, but keeps the list through a reload', () => {
    let datasetKey: string | null = 'https://example.test/a'
    const { result, rerender } = renderHook(() => useHarness({ datasetKey }))

    act(() => {
      result.current.list.onDrawn(box(0))
    })
    // A reload of the same view: no ready dataset for a moment.
    datasetKey = null
    rerender()
    datasetKey = 'https://example.test/a'
    rerender()
    expect(result.current.list.selections).toHaveLength(1)

    datasetKey = 'https://example.test/b'
    rerender()
    datasetKey = 'https://example.test/a'
    rerender()
    expect(result.current.list.selections).toEqual([])
  })

  it('adds a link’s ROI as Shared ROI once the queries can run', () => {
    let canRun = false
    const { result, rerender } = renderHook(() => useHarness({ canRun, shared: box(5) }))

    expect(result.current.list.selections).toEqual([])
    canRun = true
    rerender()

    expect(result.current.list.selections.map((selection) => selection.name)).toEqual([
      'Shared ROI',
    ])
    expect(result.current.list.activeId).toBe('selection-1')
    expect(result.current.sharedRef.current).toBeNull()
    expect(result.current.roiName).toBe('Shared ROI')
  })

  it('shows the saved selection a replayed ROI matches instead of adding a copy', () => {
    const { result } = renderHook(() => useHarness())
    const drawn: RoiSelection = {
      kind: 'box',
      bbox: {
        minX: micrometers(0.00012),
        minY: micrometers(-0.0004),
        maxX: micrometers(10.00049),
        maxY: micrometers(10),
      },
    }

    act(() => {
      result.current.list.onDrawn(drawn)
    })
    act(() => {
      result.current.list.onRename('selection-1', 'Cortex')
    })
    // A Visium view reload clears the ROI and replays it from the link,
    // which rounds coordinates to 0.001.
    act(() => {
      result.current.setHeld(null)
      result.current.sharedRef.current = box(0)
    })

    expect(result.current.list.selections.map((selection) => selection.name)).toEqual([
      'Cortex',
    ])
    expect(result.current.list.activeId).toBe('selection-1')
    expect(result.current.roiName).toBe('Cortex')
  })
})
