import { useLayoutEffect, type RefObject } from 'react'

// How far inside the window's edges a panel is kept.
export const SCREEN_MARGIN = 8
// The least height a panel is cut to, so a very short window still shows a
// few rows to scroll.
const MIN_HEIGHT = 96

interface PanelBox {
  readonly left: number
  readonly right: number
  readonly top: number
  readonly height: number
}

interface ScreenSize {
  readonly width: number
  readonly height: number
}

export interface ScreenPlacement {
  // Moves the panel sideways, back inside the window.
  readonly shiftX: number
  // The panel's height limit where it would run off the bottom; it then
  // scrolls. Null when it fits.
  readonly maxHeight: number | null
}

// Where a panel placed from its trigger goes so it stays inside the window
// (WCAG 1.4.10): a panel lined up with a trigger near the edge of a phone's
// screen moves back onto it, and one taller than the room below its top
// scrolls. A panel wider than the window keeps its left edge on screen.
export function screenPlacement(box: PanelBox, screen: ScreenSize): ScreenPlacement {
  const overLeft = SCREEN_MARGIN - box.left
  const overRight = box.right - (screen.width - SCREEN_MARGIN)
  const shiftX =
    overLeft > 0 ? overLeft : overRight > 0 ? Math.max(overLeft, -overRight) : 0
  const room = screen.height - SCREEN_MARGIN - box.top

  return {
    shiftX: Math.round(shiftX),
    maxHeight: box.height > room ? Math.max(MIN_HEIGHT, Math.floor(room)) : null,
  }
}

function placeOnScreen(element: HTMLElement): void {
  element.style.removeProperty('translate')
  element.style.removeProperty('max-height')
  element.style.removeProperty('overflow-y')

  const box = element.getBoundingClientRect()
  // Not laid out (hidden, or jsdom).
  if (box.width === 0 && box.height === 0) return

  const { shiftX, maxHeight } = screenPlacement(box, {
    width: document.documentElement.clientWidth,
    height: document.documentElement.clientHeight,
  })

  if (shiftX !== 0) element.style.setProperty('translate', `${shiftX}px 0`)
  if (maxHeight !== null) {
    element.style.setProperty('max-height', `${maxHeight}px`)
    element.style.setProperty('overflow-y', 'auto')
  }
}

// While active, keeps the element inside the window: placed as it opens,
// before it takes focus, and again when the window or the element resizes.
export function useKeepOnScreen(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
): void {
  useLayoutEffect(() => {
    const element = ref.current
    if (!active || element === null) return

    const place = () => {
      placeOnScreen(element)
    }
    place()
    window.addEventListener('resize', place)
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place)
    observer?.observe(element)

    return () => {
      window.removeEventListener('resize', place)
      observer?.disconnect()
    }
  }, [active, ref])
}
