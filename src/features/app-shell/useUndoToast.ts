import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import { isTextEntryTarget } from './activeToolModel'

// Undo for actions that remove something (plan 15.3-C): a toast
// offers Undo for 8 s, while the pointer or focus is not on it.

export const UNDO_TIMEOUT_MS = 8_000

export interface UndoOffer {
  // What was done, such as "Removed graphclust: Cluster 3".
  readonly message: string
  readonly undo: () => void
}

export interface UndoToastStore {
  readonly offer: UndoOffer | null
  // Replaces any earlier offer.
  readonly offerUndo: (offer: UndoOffer) => void
  readonly undo: () => void
  readonly dismiss: () => void
  // While held (hovered or focused) the toast stays; letting go gives it the
  // full time again.
  readonly hold: (held: boolean) => void
}

interface ShownOffer {
  readonly offer: UndoOffer
  // Restarts the timer for each offer, even with the same text.
  readonly id: number
}

let nextOfferId = 0

export function useUndoToast(timeoutMs = UNDO_TIMEOUT_MS): UndoToastStore {
  const [shown, setShown] = useState<ShownOffer | null>(null)
  const [held, setHeld] = useState(false)
  // The offer on screen, so Undo runs it once even if clicked twice.
  const shownRef = useRef<ShownOffer | null>(null)

  const show = useCallback((next: ShownOffer | null) => {
    shownRef.current = next
    setShown(next)
    setHeld(false)
  }, [])
  const offerUndo = useCallback(
    (offer: UndoOffer) => {
      nextOfferId += 1
      show({ offer, id: nextOfferId })
    },
    [show],
  )
  const dismiss = useCallback(() => {
    show(null)
  }, [show])
  const undo = useCallback(() => {
    const current = shownRef.current
    show(null)
    current?.offer.undo()
  }, [show])

  useEffect(() => {
    if (shown === null || held) return
    const timer = window.setTimeout(dismiss, timeoutMs)
    return () => {
      window.clearTimeout(timer)
    }
  }, [dismiss, held, shown, timeoutMs])

  // Ctrl+Z or Cmd+Z undoes the offered action, except in a text field, where
  // it undoes typing.
  const handleUndoKey = useEffectEvent((event: KeyboardEvent) => {
    if (
      shown === null ||
      event.defaultPrevented ||
      event.key.toLowerCase() !== 'z' ||
      !(event.ctrlKey || event.metaKey) ||
      event.shiftKey ||
      event.altKey ||
      isTextEntryTarget(event.target)
    ) {
      return
    }

    event.preventDefault()
    undo()
  })

  useEffect(() => {
    if (shown === null) return
    function handleKeyDown(event: KeyboardEvent) {
      handleUndoKey(event)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [shown])

  return { offer: shown?.offer ?? null, offerUndo, undo, dismiss, hold: setHeld }
}
