import {
  AnnotationLabelLists,
  AnnotationSetControls,
  GeometricShapesPanel,
  MetadataTracksPanel,
} from '../sections/AnnotationsSectionBlocks'
import type { AnnotationsSectionModel } from '../sections/annotationsSectionModel'

interface AnnotationHudPanelProps {
  readonly active: boolean
  readonly annotations: AnnotationsSectionModel
}

// The Annotations tab: annotation sets, metadata tracks and GeoJSON shapes.
// While hidden it renders nothing, since label lists can be long.
export function AnnotationHudPanel({ active, annotations }: AnnotationHudPanelProps) {
  if (!active) {
    return (
      <div
        id="hud-panel-annotations"
        className="hud-tab-panel"
        role="tabpanel"
        aria-labelledby="hud-tab-annotations"
        hidden
      />
    )
  }

  return (
    <div
      id="hud-panel-annotations"
      className="hud-tab-panel"
      role="tabpanel"
      aria-labelledby="hud-tab-annotations"
    >
      <section className="analysis-section" aria-labelledby="annotation-heading">
        <div className="section-heading-row">
          <h2 id="annotation-heading">Annotations</h2>
          <span
            className={annotations.isLoading ? 'status-chip is-loading' : 'status-chip'}
            aria-live="polite"
          >
            {annotations.headerCopy}
          </span>
        </div>
        <AnnotationSetControls sets={annotations.sets} />
        <AnnotationLabelLists sets={annotations.sets} />
        <MetadataTracksPanel metadataTracks={annotations.metadataTracks} />
        <GeometricShapesPanel shapes={annotations.shapes} />
      </section>
    </div>
  )
}
