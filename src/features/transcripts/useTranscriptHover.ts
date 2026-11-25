import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react'
import type { ViewerTranscriptHoverDetail } from '../../components/viewerCoreTypes'

// The viewer reports a transcript hover on every pointer move, with the
// pointer's position, and draws its own tooltip. App keeps the hovered
// transcript or bin for the Transcripts section, which shows what it is, so it
// takes a new hover only when the pointer reaches another one: moves over one
// transcript render App once, not once a move (optimization pass, O6).
export function useTranscriptHover(
  setHoveredTranscript: Dispatch<SetStateAction<ViewerTranscriptHoverDetail | null>>,
): {
  readonly handleTranscriptHover: (detail: ViewerTranscriptHoverDetail | null) => void
  // The latest hover, pointer position included, for the diagnostics dump.
  readonly latestTranscriptHoverRef: {
    readonly current: ViewerTranscriptHoverDetail | null
  }
} {
  const latestTranscriptHoverRef = useRef<ViewerTranscriptHoverDetail | null>(null)
  const handleTranscriptHover = useCallback(
    (detail: ViewerTranscriptHoverDetail | null) => {
      latestTranscriptHoverRef.current = detail
      // The same state back makes React skip the render.
      setHoveredTranscript((current) =>
        sameTranscriptHoverTarget(current, detail) ? current : detail,
      )
    },
    [setHoveredTranscript],
  )

  return { handleTranscriptHover, latestTranscriptHoverRef }
}

// Whether two hovers are over the same transcript or bin, wherever the pointer.
export function sameTranscriptHoverTarget(
  left: ViewerTranscriptHoverDetail | null,
  right: ViewerTranscriptHoverDetail | null,
): boolean {
  if (left === null || right === null) {
    return left === right
  }

  return left.transcript === right.transcript && left.aggregate === right.aggregate
}
