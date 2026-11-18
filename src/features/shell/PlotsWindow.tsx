import { PlotsPanel } from '../plots/PlotsPanel'
import type { PlotsModel } from '../plots/usePlotsModel'
import { FloatingWindow, type FloatingWindowSize } from './FloatingWindow'
import { PLOTS_WINDOW_MIN_SIZE, PLOTS_WINDOW_SIZE } from './floatingWindowModel'

// Plots of the selected genes by class (plan 22-D8): a window at the top
// right of the canvas, or to the left of the Embedding window, opened from
// Cells › Show Plots.
export function PlotsWindow({
  plots,
  open,
  onClose,
  fullWidth = false,
  rightOffset,
  onSizeChange,
}: {
  readonly plots: PlotsModel
  readonly open: boolean
  readonly onClose: () => void
  readonly fullWidth?: boolean | undefined
  readonly rightOffset?: number | undefined
  readonly onSizeChange?: ((size: FloatingWindowSize) => void) | undefined
}) {
  return (
    <FloatingWindow
      title="Plots"
      status={plots.status}
      loading={plots.loading}
      closeTitle="Close plots"
      resizeName="plots panel"
      className="shell-plots"
      bodyClassName="shell-plots-body"
      defaultSize={PLOTS_WINDOW_SIZE}
      minSize={PLOTS_WINDOW_MIN_SIZE}
      open={open}
      onClose={onClose}
      fullWidth={fullWidth}
      rightOffset={rightOffset}
      onSizeChange={onSizeChange}
    >
      <PlotsPanel plots={plots} />
    </FloatingWindow>
  )
}
