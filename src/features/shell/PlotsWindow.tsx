import { lazy } from 'react'
import { LazyPanel } from '../../components/LazyPanel'
import { useOpenedOnce } from '../../components/useOpenedOnce'
import type { PlotsModel } from '../plots/usePlotsModel'
import { FloatingWindow, type FloatingWindowSize } from './FloatingWindow'
import { PLOTS_WINDOW_MIN_SIZE, PLOTS_WINDOW_SIZE } from './floatingWindowModel'

// The figures load with the window, not with the app (O21).
const PlotsPanel = lazy(async () => {
  const module = await import('../plots/PlotsPanel')
  return { default: module.PlotsPanel }
})

// Plots of the selected genes by class (plan 22-D8): a window at the top
// right of the canvas, or to the left of the Embedding window, opened from
// the top bar's Plots toggle.
export function PlotsWindow({
  plots,
  open,
  onClose,
  fullWidth = false,
  rightOffset,
  onSizeChange,
  front = false,
  onActivate,
}: {
  readonly plots: PlotsModel
  readonly open: boolean
  readonly onClose: () => void
  readonly fullWidth?: boolean | undefined
  readonly rightOffset?: number | undefined
  readonly onSizeChange?: ((size: FloatingWindowSize) => void) | undefined
  // Drawn over the other windows; pressed or focused, it asks to be.
  readonly front?: boolean | undefined
  readonly onActivate?: (() => void) | undefined
}) {
  // Mounted from the first open on, so a closed window keeps its figures.
  const opened = useOpenedOnce(open)

  return (
    <FloatingWindow
      title="Plots"
      status={plots.status}
      loading={plots.loading}
      closeTitle="Close plots"
      controlName="plots panel"
      className="shell-plots"
      bodyClassName="shell-plots-body"
      defaultSize={PLOTS_WINDOW_SIZE}
      minSize={PLOTS_WINDOW_MIN_SIZE}
      open={open}
      onClose={onClose}
      fullWidth={fullWidth}
      rightOffset={rightOffset}
      onSizeChange={onSizeChange}
      front={front}
      onActivate={onActivate}
    >
      {opened ? (
        <LazyPanel label="Plots">
          <PlotsPanel plots={plots} />
        </LazyPanel>
      ) : null}
    </FloatingWindow>
  )
}
