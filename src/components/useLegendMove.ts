import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
} from 'react'
import {
  clampLegendPlacement,
  clampLegendPoint,
  legendPlacementStyle,
  placeLegend,
  type LegendBox,
  type LegendPlacement,
  type LegendPoint,
} from './viewerLegendPlacement'

// How far the pointer travels before the header moves the legend, so a
// click still opens or closes it.
const MOVE_THRESHOLD = 3
const KEY_STEP = 20
const KEY_MOVES: Readonly<Record<string, LegendPoint>> = {
  ArrowLeft: { left: -KEY_STEP, top: 0 },
  ArrowRight: { left: KEY_STEP, top: 0 },
  ArrowUp: { left: 0, top: -KEY_STEP },
  ArrowDown: { left: 0, top: KEY_STEP },
}

interface LegendBoxes {
  readonly legend: LegendBox
  readonly view: LegendBox
  // Where the legend is drawn now.
  readonly point: LegendPoint
}

// The box a moved legend is placed in: the layer over the whole view that
// holds the bottom-left stack (viewer.css).
function legendView(legend: HTMLElement | null): HTMLElement | null {
  const view = legend?.offsetParent
  return view instanceof HTMLElement ? view : null
}

function measureLegend(legend: HTMLElement | null): LegendBoxes | null {
  const view = legendView(legend)
  if (legend === null || view === null) return null
  const outer = view.getBoundingClientRect()
  if (outer.width === 0 || outer.height === 0) return null
  const inner = legend.getBoundingClientRect()
  return {
    legend: { width: inner.width, height: inner.height },
    view: { width: outer.width, height: outer.height },
    point: { left: inner.left - outer.left, top: inner.top - outer.top },
  }
}

export interface LegendMove {
  // Out of the stack: moved, or being dragged.
  readonly moved: boolean
  readonly dragging: boolean
  readonly style: CSSProperties | undefined
  // Where it is drawn, for the grip to read out; null in the stack.
  readonly drawn: LegendPlacement | null
  readonly headerProps: {
    readonly onPointerDown: (event: PointerEvent<HTMLElement>) => void
    readonly onClickCapture: (event: MouseEvent<HTMLElement>) => void
  }
  readonly gripProps: {
    readonly onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void
    readonly onDoubleClick: () => void
  }
}

// Moves the canvas legend out of its bottom-left stack and back: dragging
// its header, or the arrow keys on its grip, places it anywhere in the view;
// Home or a double-click on the grip, or a drop in the bottom-left corner,
// puts it back. The place is the caller's, so it outlasts the legend; a
// drag's place is the legend's own until the drop.
export function useLegendMove(
  legendRef: RefObject<HTMLElement | null>,
  // Whether the legend is drawn, so there is something to measure.
  shown: boolean,
  placement: LegendPlacement | null,
  onPlacementChange: (placement: LegendPlacement | null) => void,
): LegendMove {
  // Stops following the pointer.
  const stopDragRef = useRef<(() => void) | null>(null)
  // A drag ends in a click on the header, which must not close the legend.
  const swallowClickRef = useRef(false)
  const [dragPoint, setDragPoint] = useState<LegendPoint | null>(null)
  // The legend's and the view's sizes while moved, to keep it inside the view
  // as either changes.
  const [boxes, setBoxes] = useState<LegendBoxes | null>(null)
  const moved = placement !== null

  useEffect(() => {
    const legend = legendRef.current
    const view = legendView(legend)
    if (
      !moved ||
      !shown ||
      legend === null ||
      view === null ||
      typeof ResizeObserver === 'undefined'
    ) {
      return
    }

    const observer = new ResizeObserver(() => {
      setBoxes(measureLegend(legend))
    })
    observer.observe(legend)
    observer.observe(view)
    return () => {
      observer.disconnect()
    }
  }, [legendRef, moved, shown])

  useEffect(
    () => () => {
      stopDragRef.current?.()
    },
    [],
  )

  const drawn =
    placement === null || boxes === null
      ? placement
      : clampLegendPlacement(placement, boxes.legend, boxes.view)

  // The document follows the pointer, as its first move may already be off
  // the header. Once it moves the legend, the header captures it, so the map
  // under it sees no hover and the click that ends the drag lands on the
  // header; until then a click reaches the header's buttons.
  function handlePointerDown(event: PointerEvent<HTMLElement>) {
    swallowClickRef.current = false
    stopDragRef.current?.()
    if (event.button !== 0) return
    const start = measureLegend(legendRef.current)
    if (start === null) return

    const header = event.currentTarget
    const { pointerId, clientX: x, clientY: y } = event
    const target = header.ownerDocument
    let point = start.point
    let moving = false

    const follow = (moveEvent: globalThis.PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return
      const dx = moveEvent.clientX - x
      const dy = moveEvent.clientY - y
      if (!moving) {
        if (Math.hypot(dx, dy) < MOVE_THRESHOLD) return
        moving = true
        header.setPointerCapture?.(pointerId)
      }
      point = clampLegendPoint(
        { left: start.point.left + dx, top: start.point.top + dy },
        start.legend,
        start.view,
      )
      setDragPoint(point)
    }
    const drop = (endEvent: globalThis.PointerEvent) => {
      if (endEvent.pointerId !== pointerId) return
      stop()
      if (!moving) return
      swallowClickRef.current = endEvent.type === 'pointerup'
      setDragPoint(null)
      onPlacementChange(placeLegend(point, start.legend, start.view, true))
    }
    const stop = () => {
      target.removeEventListener('pointermove', follow)
      target.removeEventListener('pointerup', drop)
      target.removeEventListener('pointercancel', drop)
      stopDragRef.current = null
    }

    target.addEventListener('pointermove', follow)
    target.addEventListener('pointerup', drop)
    target.addEventListener('pointercancel', drop)
    stopDragRef.current = stop
  }

  function handleClickCapture(event: MouseEvent<HTMLElement>) {
    if (!swallowClickRef.current) return
    swallowClickRef.current = false
    // Enter or Space on the toggle, should the drag's click have missed.
    if (event.detail === 0) return
    event.preventDefault()
    event.stopPropagation()
  }

  function handleGripKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Home') {
      event.preventDefault()
      onPlacementChange(null)
      return
    }
    const step = KEY_MOVES[event.key]
    if (step === undefined) return

    event.preventDefault()
    const measured = measureLegend(legendRef.current)
    if (measured === null) return
    // Arrow keys never dock it: Home does.
    onPlacementChange(
      placeLegend(
        { left: measured.point.left + step.left, top: measured.point.top + step.top },
        measured.legend,
        measured.view,
        false,
      ),
    )
  }

  return {
    moved: dragPoint !== null || drawn !== null,
    dragging: dragPoint !== null,
    style:
      dragPoint !== null
        ? { left: dragPoint.left, top: dragPoint.top }
        : drawn === null
          ? undefined
          : legendPlacementStyle(drawn),
    drawn,
    headerProps: {
      onPointerDown: handlePointerDown,
      onClickCapture: handleClickCapture,
    },
    gripProps: {
      onKeyDown: handleGripKeyDown,
      onDoubleClick: () => {
        onPlacementChange(null)
      },
    },
  }
}
