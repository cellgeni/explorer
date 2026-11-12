import { useEffect, type RefObject } from 'react'
import { focusFirst } from './useDismiss'

// For a panel that opens over the page without being modal, such as the info
// drawer or the Embedding panel: opening moves focus into it, and closing
// returns focus to where it was, when focus was inside or went with it
// (UNIFIED_PLAN.md, 15.5-D). Focus that moved elsewhere stays there.
export function useFocusReturn(
  open: boolean,
  containerRef: RefObject<HTMLElement | null>,
  returnFocusRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    const container = containerRef.current
    if (container === null) return

    if (open) {
      returnFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null
      focusFirst(container)
      return
    }

    const active = document.activeElement
    const lost = active === null || active === document.body || container.contains(active)
    if (lost) returnFocusRef.current?.focus()
  }, [containerRef, open, returnFocusRef])
}
