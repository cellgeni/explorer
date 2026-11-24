// Where small overlays go so they stay inside the frame that clips them
// (EXP-304): hover tooltips beside the pointer, and the distance label
// centred over its line.

// A tooltip's distance from the pointer, and every overlay's from the edges.
export const POINTER_TOOLTIP_OFFSET = 10
export const OVERLAY_EDGE = 4

// The offset along one axis of a tooltip of `size` at `position` in a frame
// of `room`: after the pointer where it fits, else before it, else as far
// inside as it goes (a tooltip larger than the room keeps its start).
export function pointerTooltipOffset(
  position: number,
  size: number,
  room: number,
): number {
  const after = POINTER_TOOLTIP_OFFSET
  if (position + after + size <= room - OVERLAY_EDGE) return after

  const before = -(POINTER_TOOLTIP_OFFSET + size)
  if (position + before >= OVERLAY_EDGE) return before

  return Math.max(OVERLAY_EDGE - position, room - OVERLAY_EDGE - size - position)
}

// How far a label of `size` centred on `centre` moves along its axis to stay
// inside `room`.
export function centredLabelShift(centre: number, size: number, room: number): number {
  const half = size / 2
  const low = OVERLAY_EDGE + half
  const high = room - OVERLAY_EDGE - half
  if (high < low) return low - centre
  return Math.min(Math.max(centre, low), high) - centre
}
