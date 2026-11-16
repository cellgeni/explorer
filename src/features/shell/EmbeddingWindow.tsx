import { EmbeddingControls, EmbeddingPlot } from '../sections/EmbeddingBlocks'
import type { EmbeddingModel } from '../sections/embeddingModel'
import { FloatingWindow, type FloatingWindowSize } from './FloatingWindow'
import { EMBEDDING_WINDOW_MIN_SIZE, EMBEDDING_WINDOW_SIZE } from './floatingWindowModel'

// The embedding beside the tissue (plan 15.2-G, F23): a window at the top
// right of the canvas, opened from Cells › Show Embedding. Closing returns
// focus to Show Embedding (15.5-D).
export function EmbeddingWindow({
  embedding,
  open,
  onClose,
  fullWidth = false,
  onSizeChange,
}: {
  readonly embedding: EmbeddingModel
  readonly open: boolean
  readonly onClose: () => void
  // Narrow screens (15.2-I): the canvas's width, less a margin.
  readonly fullWidth?: boolean | undefined
  // The Plots window opens to the left of this one (22-D8).
  readonly onSizeChange?: ((size: FloatingWindowSize) => void) | undefined
}) {
  return (
    <FloatingWindow
      title="Embedding"
      status={embedding.copy}
      loading={embedding.loading}
      closeTitle="Close embedding"
      resizeName="embedding panel"
      className="shell-embedding"
      bodyClassName="shell-embedding-body"
      defaultSize={EMBEDDING_WINDOW_SIZE}
      minSize={EMBEDDING_WINDOW_MIN_SIZE}
      open={open}
      onClose={onClose}
      fullWidth={fullWidth}
      onSizeChange={onSizeChange}
    >
      <EmbeddingControls embedding={embedding} />
      <EmbeddingPlot embedding={embedding} />
    </FloatingWindow>
  )
}
