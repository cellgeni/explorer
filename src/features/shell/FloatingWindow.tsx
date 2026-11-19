import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { CloseIcon, GripIcon, IconButton } from '../../components/ui'
import { classNames } from '../../components/ui/classNames'
import { useFocusReturn } from '../../components/ui/useFocusReturn'
import { isTextEntryTarget } from '../app-shell/activeToolModel'

export interface FloatingWindowSize {
  readonly width: number
  readonly height: number
}

// Where a moved window sits: its distance from the canvas's right and top
// edges, so it stays put as the grip at its bottom left resizes it.
interface FloatingWindowPosition {
  readonly right: number
  readonly top: number
}

// The CSS insets from the canvas's right and top edges (--space-3), also kept
// clear at its left and bottom.
const RIGHT_INSET = 12
const TOP_INSET = 12
const KEY_STEP = 20
// How far the pointer travels before the title bar moves the window, so a
// click that only brings a window to the front leaves it where it is.
const MOVE_THRESHOLD = 3

function clampWindowSize(
  size: FloatingWindowSize,
  minSize: FloatingWindowSize,
  maxSize: FloatingWindowSize,
): FloatingWindowSize {
  return {
    width: Math.round(
      Math.max(
        minSize.width,
        Math.min(Math.max(minSize.width, maxSize.width), size.width),
      ),
    ),
    height: Math.round(
      Math.max(
        minSize.height,
        Math.min(Math.max(minSize.height, maxSize.height), size.height),
      ),
    ),
  }
}

// Keeps a moved window inside the canvas, as .shell-floating.is-moved does
// when the canvas shrinks under it.
function clampWindowPosition(
  position: FloatingWindowPosition,
  size: FloatingWindowSize,
  canvas: FloatingWindowSize | null,
): FloatingWindowPosition {
  const right =
    canvas === null
      ? position.right
      : Math.min(position.right, canvas.width - size.width - RIGHT_INSET)
  const top =
    canvas === null
      ? position.top
      : Math.min(position.top, canvas.height - size.height - TOP_INSET)
  return {
    right: Math.round(Math.max(RIGHT_INSET, right)),
    top: Math.round(Math.max(TOP_INSET, top)),
  }
}

export interface FloatingWindowProps {
  // The heading, which also names the region.
  readonly title: string
  // The line under the heading.
  readonly status: string
  readonly loading?: boolean | undefined
  readonly closeTitle: string
  // Names the window in the move and resize controls' titles, such as
  // "embedding panel".
  readonly controlName: string
  readonly className: string
  readonly bodyClassName: string
  readonly defaultSize: FloatingWindowSize
  readonly minSize: FloatingWindowSize
  readonly open: boolean
  readonly onClose: () => void
  // Narrow screens (15.2-I): the canvas's width, less a margin.
  readonly fullWidth?: boolean | undefined
  // How far from the canvas's right edge it sits, in pixels; the CSS inset
  // by default. A second window opens to the left of the first (22-D8).
  readonly rightOffset?: number | undefined
  readonly onSizeChange?: ((size: FloatingWindowSize) => void) | undefined
  // Drawn over the other windows: the one last clicked or focused.
  readonly front?: boolean | undefined
  // Pressed or focused, so it can come to the front.
  readonly onActivate?: (() => void) | undefined
  readonly children: ReactNode
}

// A window over the canvas (plan 15.2-G, 22-D): anchored at the top right,
// moved by dragging its title bar or from its grip button by arrow keys, and
// resized from the grip at its bottom left by pointer or arrow keys; each
// grip says the new place or size. It stays mounted while closed, so it
// keeps its size and place. Opening moves focus to its Close button; closing
// returns focus to what opened it (15.5-D); Escape closes it.
export function FloatingWindow({
  title,
  status,
  loading = false,
  closeTitle,
  controlName,
  className,
  bodyClassName,
  defaultSize,
  minSize,
  open,
  onClose,
  fullWidth = false,
  rightOffset,
  onSizeChange,
  front = false,
  onActivate,
  children,
}: FloatingWindowProps) {
  const headingId = useId()
  const sizeId = useId()
  const positionId = useId()
  const panelRef = useRef<HTMLElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const dragRef = useRef<{ x: number; y: number; size: FloatingWindowSize } | null>(null)
  const moveRef = useRef<{
    x: number
    y: number
    position: FloatingWindowPosition
    moving: boolean
  } | null>(null)
  const [size, setSize] = useState<FloatingWindowSize>(defaultSize)
  // Null until moved: until then it keeps the place the shell gives it.
  const [position, setPosition] = useState<FloatingWindowPosition | null>(null)
  useFocusReturn(open, panelRef, returnFocusRef, closeRef)
  const offset = fullWidth ? undefined : rightOffset
  // Under 860 px the window spans the canvas and stays at the top.
  const moved = fullWidth ? null : position
  const placed = moved ?? { right: offset ?? RIGHT_INSET, top: TOP_INSET }

  useEffect(() => {
    onSizeChange?.(size)
  }, [onSizeChange, size])

  function canvasSize(): FloatingWindowSize | null {
    const canvas = panelRef.current?.parentElement
    return canvas === null || canvas === undefined || canvas.clientWidth === 0
      ? null
      : { width: canvas.clientWidth, height: canvas.clientHeight }
  }

  // Where the window is drawn now, within the canvas.
  function currentPosition(): FloatingWindowPosition {
    return moved === null ? placed : clampWindowPosition(moved, size, canvasSize())
  }

  function maxSize(): FloatingWindowSize {
    const canvas = canvasSize()
    if (canvas === null) {
      return { width: Number.POSITIVE_INFINITY, height: Number.POSITIVE_INFINITY }
    }
    // Up to the canvas's left and bottom insets, from where it sits.
    const { right, top } = currentPosition()
    return {
      width: canvas.width - right - RIGHT_INSET,
      height: canvas.height - top - TOP_INSET,
    }
  }

  function resize(next: (current: FloatingWindowSize) => FloatingWindowSize) {
    const max = maxSize()
    setSize((current) => clampWindowSize(next(current), minSize, max))
  }

  function move(next: FloatingWindowPosition) {
    setPosition(clampWindowPosition(next, size, canvasSize()))
  }

  function handlePointerDown(event: PointerEvent<HTMLButtonElement>) {
    event.currentTarget.setPointerCapture?.(event.pointerId)
    dragRef.current = { x: event.clientX, y: event.clientY, size }
  }

  function handlePointerMove(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current
    if (drag === null) return

    // The window is anchored top right, so dragging the grip left widens it.
    resize(() => ({
      width: drag.size.width + (drag.x - event.clientX),
      height: drag.size.height + (event.clientY - drag.y),
    }))
  }

  function handlePointerUp(event: PointerEvent<HTMLButtonElement>) {
    dragRef.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const delta: Readonly<Record<string, FloatingWindowSize>> = {
      ArrowLeft: { width: KEY_STEP, height: 0 },
      ArrowRight: { width: -KEY_STEP, height: 0 },
      ArrowDown: { width: 0, height: KEY_STEP },
      ArrowUp: { width: 0, height: -KEY_STEP },
    }
    const step = delta[event.key]
    if (step === undefined) return

    event.preventDefault()
    resize((current) => ({
      width: current.width + step.width,
      height: current.height + step.height,
    }))
  }

  // The title bar moves the window, but its Close button does not.
  function handleTitlePointerDown(event: PointerEvent<HTMLElement>) {
    if (fullWidth || event.button !== 0) return
    if (
      event.target instanceof Element &&
      event.target.closest('button:not(.shell-floating-move)') !== null
    ) {
      return
    }

    event.currentTarget.setPointerCapture?.(event.pointerId)
    moveRef.current = {
      x: event.clientX,
      y: event.clientY,
      position: currentPosition(),
      moving: false,
    }
  }

  function handleTitlePointerMove(event: PointerEvent<HTMLElement>) {
    const drag = moveRef.current
    if (drag === null) return

    const dx = event.clientX - drag.x
    const dy = event.clientY - drag.y
    if (!drag.moving && Math.hypot(dx, dy) < MOVE_THRESHOLD) return

    drag.moving = true
    // Anchored at the right, so dragging right brings it nearer that edge.
    move({ right: drag.position.right - dx, top: drag.position.top + dy })
  }

  function handleTitlePointerUp(event: PointerEvent<HTMLElement>) {
    moveRef.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  }

  function handleMoveKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const delta: Readonly<Record<string, FloatingWindowPosition>> = {
      ArrowLeft: { right: KEY_STEP, top: 0 },
      ArrowRight: { right: -KEY_STEP, top: 0 },
      ArrowDown: { right: 0, top: KEY_STEP },
      ArrowUp: { right: 0, top: -KEY_STEP },
    }
    const step = delta[event.key]
    if (step === undefined) return

    event.preventDefault()
    const current = currentPosition()
    move({ right: current.right + step.right, top: current.top + step.top })
  }

  function windowStyle(): CSSProperties {
    if (fullWidth) return { height: size.height }
    if (moved !== null) {
      // .shell-floating.is-moved keeps it inside the canvas from these.
      return {
        width: size.width,
        height: size.height,
        '--floating-right': `${moved.right}px`,
        '--floating-top': `${moved.top}px`,
        '--floating-width': `${size.width}px`,
        '--floating-height': `${size.height}px`,
      } as CSSProperties
    }
    return {
      width: size.width,
      height: size.height,
      ...(offset === undefined
        ? {}
        : {
            right: offset,
            maxWidth: `calc(100% - ${offset + RIGHT_INSET}px)`,
          }),
    }
  }

  return (
    <section
      ref={panelRef}
      className={classNames(
        'shell-floating',
        className,
        fullWidth && 'is-full-width',
        moved !== null && 'is-moved',
        front && 'is-front',
      )}
      aria-labelledby={headingId}
      hidden={!open}
      style={windowStyle()}
      onPointerDownCapture={onActivate}
      onFocus={onActivate}
      onKeyDown={(event) => {
        if (
          event.key !== 'Escape' ||
          event.defaultPrevented ||
          isTextEntryTarget(event.target)
        ) {
          return
        }
        event.preventDefault()
        onClose()
      }}
    >
      <header
        className={classNames('ui-card-header', !fullWidth && 'shell-floating-title')}
        onPointerDown={handleTitlePointerDown}
        onPointerMove={handleTitlePointerMove}
        onPointerUp={handleTitlePointerUp}
        onPointerCancel={handleTitlePointerUp}
      >
        <div className="ui-card-heading">
          <h2 id={headingId}>{title}</h2>
          <p className={loading ? 'shell-card-status is-loading' : undefined}>{status}</p>
        </div>
        {fullWidth ? null : (
          <IconButton
            className="shell-floating-move"
            title={`Move the ${controlName}: drag its title bar, or use the arrow keys`}
            aria-label={`Move the ${controlName}`}
            aria-describedby={positionId}
            icon={<GripIcon />}
            onKeyDown={handleMoveKeyDown}
          />
        )}
        <IconButton
          ref={closeRef}
          title={closeTitle}
          icon={<CloseIcon />}
          onClick={onClose}
        />
      </header>
      <div className={classNames('shell-floating-body', bodyClassName)}>{children}</div>
      <button
        type="button"
        className="shell-floating-resize"
        title={`Resize the ${controlName}: drag, or use the arrow keys`}
        aria-label={`Resize the ${controlName}`}
        aria-describedby={sizeId}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onKeyDown={handleKeyDown}
      >
        <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
          <path d="M1 3l8 8M1 7l4 4" />
        </svg>
      </button>
      {/* The grips' values: read with them, and again after each change. */}
      <span id={sizeId} className="visually-hidden" aria-live="polite">
        {fullWidth ? `${size.height} px high` : `${size.width} by ${size.height} px`}
      </span>
      {fullWidth ? null : (
        <span id={positionId} className="visually-hidden" aria-live="polite">
          {`${placed.top} px from the top, ${placed.right} px from the right`}
        </span>
      )}
    </section>
  )
}
