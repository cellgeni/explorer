import { useCallback, useEffectEvent, useLayoutEffect, useRef } from 'react'

// A control that takes itself away (a row's Remove) or turns itself off
// (Load while it loads) hands focus on, so focus does not fall to the page
// (EXP-316, as EXP-294 did for a selection's Delete). Call the returned
// function as the control acts, with its index among controls of its kind.
// Once the control has gone or is disabled, `next` picks what takes focus:
// the control now at that index, the last one, or a field or heading.
export function useKeepFocus(
  next: (index: number) => HTMLElement | null | undefined,
): (index?: number) => void {
  const pendingRef = useRef<{ readonly control: Element; readonly index: number } | null>(
    null,
  )

  const handOn = useEffectEvent(() => {
    const pending = pendingRef.current
    if (pending === null) return

    const { control, index } = pending
    const active = document.activeElement
    if (control.isConnected && !control.matches(':disabled')) {
      // Not gone yet, or focus was moved away from it.
      if (active !== control) pendingRef.current = null
      return
    }
    pendingRef.current = null
    if (active !== null && active !== document.body && active !== control) return
    next(index)?.focus()
  })

  // After every render, as the control goes in a later one.
  useLayoutEffect(() => {
    handOn()
  })

  return useCallback((index = 0) => {
    const active = document.activeElement
    pendingRef.current =
      active instanceof HTMLElement && active !== document.body
        ? { control: active, index }
        : null
  }, [])
}

// Where the focused element is among `elements`, or 0.
export function focusedIndexAmong(elements: ArrayLike<Element>): number {
  return Math.max(0, Array.prototype.indexOf.call(elements, document.activeElement))
}

// The control at `index`, or the last one when fewer are left.
export function nthOrLast<T extends Element>(
  elements: ArrayLike<T> | null | undefined,
  index: number,
): T | undefined {
  if (elements == null || elements.length === 0) return undefined
  return elements[Math.min(index, elements.length - 1)]
}
