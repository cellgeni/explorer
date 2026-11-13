import { memo } from 'react'
import type { AxesModel } from './viewerAxesModel'

// µm axes (plan 15.4-E): rulers along the top and left edges of
// the canvas. They only label it; the coordinate readout says the same to
// screen readers.
export const ViewerAxes = memo(function ViewerAxes({
  model,
}: {
  readonly model: AxesModel
}) {
  return (
    <div className="viewer-axes" aria-hidden="true">
      <div className="viewer-axis viewer-axis-x">
        <span className="viewer-axis-unit">{model.unitLabel}</span>
        {model.x.map((tick) => (
          <span
            key={tick.label}
            className="viewer-axis-tick"
            style={{ left: tick.position }}
          >
            <span className="viewer-axis-label">{tick.label}</span>
          </span>
        ))}
      </div>
      <div className="viewer-axis viewer-axis-y">
        {model.y.map((tick) => (
          <span
            key={tick.label}
            className="viewer-axis-tick"
            style={{ top: tick.position }}
          >
            <span className="viewer-axis-label">{tick.label}</span>
          </span>
        ))}
      </div>
      <span className="viewer-axis-corner" />
    </div>
  )
})
