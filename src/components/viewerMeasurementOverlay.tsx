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
        className={`measurement-label${model.isDraft ? ' is-draft' : ''}`}
        style={model.labelStyle}
      >
        {model.label}
      </span>
    </div>
  )
}
