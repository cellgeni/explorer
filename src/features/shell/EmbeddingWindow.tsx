import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { CloseIcon, IconButton } from '../../components/ui'
import { useFocusReturn } from '../../components/ui/useFocusReturn'
import { isTextEntryTarget } from '../app-shell/activeToolModel'
import { EmbeddingControls, EmbeddingPlot } from '../sections/EmbeddingBlocks'
import type { EmbeddingModel } from '../sections/embeddingModel'

interface PanelSize {
  readonly width: number
  readonly height: number
}

const DEFAULT_SIZE: PanelSize = { width: 360, height: 400 }
const MIN_SIZE: PanelSize = { width: 280, height: 260 }
// Space kept between the panel and the canvas edges.
const CANVAS_MARGIN = 24
const KEY_STEP = 20

function clampPanelSize(size: PanelSize, maxSize: PanelSize): PanelSize {
  return {
    width: Math.round(
      Math.max(
        MIN_SIZE.width,
        Math.min(Math.max(MIN_SIZE.width, maxSize.width), size.width),
      ),
    ),
    height: Math.round(
      Math.max(
        MIN_SIZE.height,
        Math.min(Math.max(MIN_SIZE.height, maxSize.height), size.height),
      ),
    ),
  }
}

// The embedding beside the tissue (UNIFIED_PLAN.md, 15.2-G, F23): a panel at
// the top right of the canvas, opened from Cells › Show Embedding. The grip
// at its bottom left resizes it, by pointer or arrow keys, and says the new
// size. It stays mounted while closed, so it keeps its size. Opening moves
// focus into it; closing returns focus to Show Embedding (15.5-D).
export function EmbeddingWindow({
  embedding,
  open,
  onClose,
  fullWidth = false,
}: {
  readonly embedding: EmbeddingModel
  readonly open: boolean
  readonly onClose: () => void
  // Narrow screens (15.2-I): the canvas's width, less a margin.
  readonly fullWidth?: boolean | undefined
}) {
  const headingId = useId()
  const sizeId = useId()
  const panelRef = useRef<HTMLElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const dragRef = useRef<{ x: number; y: number; size: PanelSize } | null>(null)
  const [size, setSize] = useState<PanelSize>(DEFAULT_SIZE)
  useFocusReturn(open, panelRef, returnFocusRef)

  function maxSize(): PanelSize {
    const canvas = panelRef.current?.parentElement
    return canvas === null || canvas === undefined || canvas.clientWidth === 0
      ? { width: Number.POSITIVE_INFINITY, height: Number.POSITIVE_INFINITY }
      : {
          width: canvas.clientWidth - CANVAS_MARGIN,
          height: canvas.clientHeight - CANVAS_MARGIN,
        }
  }

  function resize(next: (current: PanelSize) => PanelSize) {
    const max = maxSize()
    setSize((current) => clampPanelSize(next(current), max))
  }

  function handlePointerDown(event: PointerEvent<HTMLButtonElement>) {
    event.currentTarget.setPointerCapture?.(event.pointerId)
    dragRef.current = { x: event.clientX, y: event.clientY, size }
  }

  function handlePointerMove(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current
    if (drag === null) return

    // The panel is anchored top right, so dragging the grip left widens it.
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
    const delta: Readonly<Record<string, PanelSize>> = {
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
      className={fullWidth ? 'shell-embedding is-full-width' : 'shell-embedding'}
      aria-labelledby={headingId}
      hidden={!open}
      style={
        fullWidth ? { height: size.height } : { width: size.width, height: size.height }
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
          <h2 id={headingId}>Embedding</h2>
          <p className={embedding.loading ? 'shell-card-status is-loading' : undefined}>
            {embedding.copy}
          </p>
        </div>
        <IconButton title="Close embedding" icon={<CloseIcon />} onClick={onClose} />
      </header>
      <div className="shell-embedding-body">
        <EmbeddingControls embedding={embedding} />
        <EmbeddingPlot embedding={embedding} />
      </div>
      <button
        type="button"
        className="shell-embedding-resize"
        title="Resize the embedding panel: drag, or use the arrow keys"
        aria-label="Resize the embedding panel"
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
