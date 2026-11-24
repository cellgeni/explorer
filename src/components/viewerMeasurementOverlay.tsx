import { useLayoutEffect, useRef } from 'react'
import { centredLabelShift } from './overlayPlacement'
import type { MeasurementLine, MeasurementOverlayModel } from './viewerMeasurements'

export interface MeasurementDraft {
  readonly start: MeasurementLine['start']
  readonly current: MeasurementLine['end']
}

export interface MeasurementState {
  readonly resetKey: number
  readonly draft: MeasurementDraft | null
  readonly line: MeasurementLine | null
}

export function MeasurementOverlay({
  model,
}: {
  readonly model: MeasurementOverlayModel
}) {
  const labelRef = useRef<HTMLSpanElement>(null)

  // The label is centred over the line's midpoint; near the frame's left or
  // right edge it moves along so the frame does not cut it off (EXP-304).
  useLayoutEffect(() => {
    const label = labelRef.current
    const frame = label?.offsetParent
    if (label == null || !(frame instanceof HTMLElement) || label.offsetWidth === 0) {
      return
    }

    const shift = centredLabelShift(
      label.offsetLeft,
      label.offsetWidth,
      frame.clientWidth,
    )
    label.style.translate = shift === 0 ? '' : `${shift}px 0`
  })

  return (
    <div className="measurement-overlay">
      <svg className="measurement-svg" focusable="false" aria-hidden="true">
        <line
          className={`measurement-line${model.isDraft ? ' is-draft' : ''}`}
          x1={model.start.x}
          y1={model.start.y}
          x2={model.end.x}
          y2={model.end.y}
        />
        <circle
          className="measurement-endpoint"
          cx={model.start.x}
          cy={model.start.y}
          r="3"
        />
        <circle
          className="measurement-endpoint"
          cx={model.end.x}
          cy={model.end.y}
          r="3"
        />
      </svg>
      <span
        ref={labelRef}
        className={`measurement-label${model.isDraft ? ' is-draft' : ''}`}
        style={model.labelStyle}
      >
        {model.label}
      </span>
    </div>
  )
}
