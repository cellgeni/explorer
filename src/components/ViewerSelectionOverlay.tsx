import type { SelectionOverlayModel } from './viewerSelectionModel'

// Marks the selected cell, spot or bin over the canvas. It is SVG next to the
// deck.gl canvas, so selecting does not redraw the map.
export function ViewerSelectionOverlay({
  model,
}: {
  readonly model: SelectionOverlayModel
}) {
  return (
    <svg className="viewer-selection-overlay" focusable="false" aria-hidden="true">
      {model.kind === 'ring' ? (
        <circle
          className="viewer-selection-mark"
          cx={model.cx}
          cy={model.cy}
          r={model.r}
        />
      ) : (
        <path className="viewer-selection-mark" d={model.d} />
      )}
    </svg>
  )
}
