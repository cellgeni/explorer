import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

// A panel or view that closes while it holds focus (its Close, Open or 2D
// View button) hands focus back to the control that was focused when it
// opened, such as the bar's Show beside button or the Cells View 3D button,
// if that is still on the page, or else to the canvas, as cards do (15.5-D).
export function useFocusHandOff(ref: RefObject<HTMLElement | null>): void {
  const openerRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const active = document.activeElement
    openerRef.current =
      active instanceof HTMLElement &&
      active !== document.body &&
      ref.current?.contains(active) !== true
        ? active
        : null
  }, [ref])

  // A layout cleanup runs while the view is still in the page.
  useLayoutEffect(() => {
    const container = ref.current
    return () => {
      if (container === null || !container.contains(document.activeElement)) return

      const opener = openerRef.current
      queueMicrotask(() => {
        const active = document.activeElement
        if (active !== null && active !== document.body) return

        if (opener?.isConnected === true) {
          opener.focus()
          return
        }
        document.querySelector<HTMLElement>('.viewport-frame')?.focus()
      })
    }
  }, [ref])
}
