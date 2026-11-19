import { EmbeddingControls, EmbeddingPlot } from '../sections/EmbeddingBlocks'
import type { EmbeddingModel } from '../sections/embeddingModel'
import { FloatingWindow, type FloatingWindowSize } from './FloatingWindow'
import { EMBEDDING_WINDOW_MIN_SIZE, EMBEDDING_WINDOW_SIZE } from './floatingWindowModel'

// The embedding beside the tissue (plan 15.2-G, F23): a window at the top
// right of the canvas, opened from the top bar's Embedding toggle. Closing
// returns focus to the toggle (15.5-D).
export function EmbeddingWindow({
  embedding,
  open,
  onClose,
  fullWidth = false,
  onSizeChange,
  front = false,
  onActivate,
}: {
  readonly embedding: EmbeddingModel
  readonly open: boolean
  readonly onClose: () => void
  // Narrow screens (15.2-I): the canvas's width, less a margin.
  readonly fullWidth?: boolean | undefined
  // The Plots window opens to the left of this one (22-D8).
  readonly onSizeChange?: ((size: FloatingWindowSize) => void) | undefined
  // Drawn over the other windows; pressed or focused, it asks to be.
  readonly front?: boolean | undefined
  readonly onActivate?: (() => void) | undefined
}) {
  return (
    <FloatingWindow
      title="Embedding"
      status={embedding.copy}
      loading={embedding.loading}
      closeTitle="Close embedding"
      controlName="embedding panel"
      className="shell-embedding"
      bodyClassName="shell-embedding-body"
      defaultSize={EMBEDDING_WINDOW_SIZE}
      minSize={EMBEDDING_WINDOW_MIN_SIZE}
      open={open}
      onClose={onClose}
      fullWidth={fullWidth}
      onSizeChange={onSizeChange}
      front={front}
      onActivate={onActivate}
    >
      <EmbeddingControls embedding={embedding} />
      <EmbeddingPlot embedding={embedding} />
    </FloatingWindow>
  )
}
