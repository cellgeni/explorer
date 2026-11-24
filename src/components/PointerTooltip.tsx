import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { pointerTooltipOffset } from './overlayPlacement'

// A hover tooltip at the pointer (x, y in its frame), beside it where it
// fits and flipped to its left or above it near the frame's right or bottom
// edge, so the frame never cuts it off (EXP-304). Until measured, the
// stylesheet's offset holds.
export function PointerTooltip({
  x,
  y,
  className,
  children,
}: {
  readonly x: number
  readonly y: number
  readonly className: string
  readonly children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const tooltip = ref.current
    const frame = tooltip?.offsetParent
    if (tooltip == null || !(frame instanceof HTMLElement) || tooltip.offsetWidth === 0) {
      return
    }

    const dx = pointerTooltipOffset(x, tooltip.offsetWidth, frame.clientWidth)
    const dy = pointerTooltipOffset(y, tooltip.offsetHeight, frame.clientHeight)
    tooltip.style.transform = `translate(${dx}px, ${dy}px)`
  })

  return (
    <div ref={ref} className={className} style={{ left: x, top: y }} aria-hidden="true">
      {children}
    </div>
  )
}
