import { CellQueryPanel } from '../query/CellQueryPanel'
import type { CellQueryModel } from '../query/useCellQueryModel'
import { FloatingWindow, type FloatingWindowSize } from './FloatingWindow'
import { QUERY_WINDOW_MIN_SIZE, QUERY_WINDOW_SIZE } from './floatingWindowModel'

// Cell Query (plan 23-D9): conditions on the cells' columns and a table of
// the cells that match, opened from Cells › Show Query, to the left of the
// other open windows.
export function QueryWindow({
  query,
  open,
  onClose,
  fullWidth = false,
  rightOffset,
  onSizeChange,
}: {
  readonly query: CellQueryModel
  readonly open: boolean
  readonly onClose: () => void
  readonly fullWidth?: boolean | undefined
  readonly rightOffset?: number | undefined
  readonly onSizeChange?: ((size: FloatingWindowSize) => void) | undefined
}) {
  return (
    <FloatingWindow
      title="Cell Query"
      status={query.status}
      loading={query.loading}
      closeTitle="Close cell query"
      resizeName="cell query panel"
      className="shell-query"
      bodyClassName="shell-query-body"
      defaultSize={QUERY_WINDOW_SIZE}
      minSize={QUERY_WINDOW_MIN_SIZE}
      open={open}
      onClose={onClose}
      fullWidth={fullWidth}
      rightOffset={rightOffset}
      onSizeChange={onSizeChange}
    >
      {/* Drawn only while open: App renders often while a dataset loads,
          and the conditions and table are not needed until then. The window
          stays mounted, so it keeps its size. */}
      {open ? <CellQueryPanel query={query} /> : null}
    </FloatingWindow>
  )
}
