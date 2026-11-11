import { useEffect, useEffectEvent, type RefObject } from 'react'

export type DismissReason = 'escape' | 'outside'

// While active, calls onDismiss when Escape is pressed or the pointer goes
// down outside every element in refs.
export function useDismiss(
  active: boolean,
  refs: readonly RefObject<HTMLElement | null>[],
  onDismiss: (reason: DismissReason) => void,
): void {
  const dismiss = useEffectEvent(onDismiss)
  const isInside = useEffectEvent((target: EventTarget | null) =>
    refs.some((ref) => target instanceof Node && ref.current?.contains(target)),
  )

  useEffect(() => {
    if (!active) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') dismiss('escape')
    }
    function handlePointerDown(event: PointerEvent) {
      if (!isInside(event.target)) dismiss('outside')
    }

    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('pointerdown', handlePointerDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [active])
}

const FOCUSABLE =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

// Moves focus to the first focusable element inside container, or to the
// container itself.
export function focusFirst(container: HTMLElement): void {
  const target = container.querySelector<HTMLElement>(FOCUSABLE) ?? container
  target.focus()
}
