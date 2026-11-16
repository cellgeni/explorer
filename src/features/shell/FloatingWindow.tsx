import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { CloseIcon, IconButton } from '../../components/ui'
import { classNames } from '../../components/ui/classNames'
import { useFocusReturn } from '../../components/ui/useFocusReturn'
import { isTextEntryTarget } from '../app-shell/activeToolModel'

export interface FloatingWindowSize {
  readonly width: number
  readonly height: number
}

// Space kept between a window and the canvas edges.
const CANVAS_MARGIN = 24
// The CSS inset from the canvas's right edge (--space-3).
const RIGHT_INSET = 12
const KEY_STEP = 20

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

export interface FloatingWindowProps {
  // The heading, which also names the region.
  readonly title: string
  // The line under the heading.
  readonly status: string
  readonly loading?: boolean | undefined
  readonly closeTitle: string
  // Names the window in the resize grip's title, such as "embedding panel".
  readonly resizeName: string
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
  readonly children: ReactNode
}

// A window over the canvas (plan 15.2-G, 22-D): anchored at the top right,
// resized from the grip at its bottom left by pointer or arrow keys, which
// says the new size. It stays mounted while closed, so it keeps its size.
// Opening moves focus into it; closing returns focus to what opened it
// (15.5-D); Escape closes it.
export function FloatingWindow({
  title,
  status,
  loading = false,
  closeTitle,
  resizeName,
  className,
  bodyClassName,
  defaultSize,
  minSize,
  open,
  onClose,
  fullWidth = false,
  rightOffset,
  onSizeChange,
  children,
}: FloatingWindowProps) {
  const headingId = useId()
  const sizeId = useId()
  const panelRef = useRef<HTMLElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const dragRef = useRef<{ x: number; y: number; size: FloatingWindowSize } | null>(null)
  const [size, setSize] = useState<FloatingWindowSize>(defaultSize)
  useFocusReturn(open, panelRef, returnFocusRef)
  const offset = fullWidth ? undefined : rightOffset

  useEffect(() => {
    onSizeChange?.(size)
  }, [onSizeChange, size])

  function maxSize(): FloatingWindowSize {
    const canvas = panelRef.current?.parentElement
    return canvas === null || canvas === undefined || canvas.clientWidth === 0
      ? { width: Number.POSITIVE_INFINITY, height: Number.POSITIVE_INFINITY }
      : {
          width:
            canvas.clientWidth - CANVAS_MARGIN - ((offset ?? RIGHT_INSET) - RIGHT_INSET),
          height: canvas.clientHeight - CANVAS_MARGIN,
        }
  }

  function resize(next: (current: FloatingWindowSize) => FloatingWindowSize) {
    const max = maxSize()
    setSize((current) => clampWindowSize(next(current), minSize, max))
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

  return (
    <section
      ref={panelRef}
      className={classNames('shell-floating', className, fullWidth && 'is-full-width')}
      aria-labelledby={headingId}
      hidden={!open}
      style={
        fullWidth
          ? { height: size.height }
          : {
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
      <header className="ui-card-header">
        <div className="ui-card-heading">
          <h2 id={headingId}>{title}</h2>
          <p className={loading ? 'shell-card-status is-loading' : undefined}>{status}</p>
        </div>
        <IconButton title={closeTitle} icon={<CloseIcon />} onClick={onClose} />
      </header>
      <div className={classNames('shell-floating-body', bodyClassName)}>{children}</div>
      <button
        type="button"
        className="shell-floating-resize"
        title={`Resize the ${resizeName}: drag, or use the arrow keys`}
        aria-label={`Resize the ${resizeName}`}
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
      {/* The grip's value: read with it, and again after each change. */}
      <span id={sizeId} className="visually-hidden" aria-live="polite">
        {fullWidth ? `${size.height} px high` : `${size.width} by ${size.height} px`}
      </span>
    </section>
  )
}
