import { MICROMETERS } from '../../data/units'
import type { CellBoundaryDatum } from '../../rendering/deckLayers'
import { summarizeNucleusShapes } from './cellDetailModel'

// One row per nucleus drawn for the selected cell. Rows appear only while
// nucleus outlines are shown and loaded.
export function CellNucleusRows({
  nuclei,
  unitLabel = MICROMETERS,
}: {
  readonly nuclei: readonly CellBoundaryDatum[]
  // µm, or "units" where a dataset's are unknown (EXP-052).
  readonly unitLabel?: string | undefined
}) {
  const shapes = summarizeNucleusShapes(nuclei)

  return shapes.map((shape, index) => {
    const value = [
      shape.areaMicrometersSquared === undefined
        ? undefined
        : `${formatShapeNumber(shape.areaMicrometersSquared)} ${unitLabel}²`,
      shape.circularity === undefined
        ? undefined
        : `circularity ${formatShapeNumber(shape.circularity)}`,
    ]
      .filter((part): part is string => part !== undefined)
      .join(', ')

    return (
      <div key={shape.id}>
        <dt title={shape.id}>
          {shapes.length === 1 ? 'Nucleus' : `Nucleus ${(index + 1).toLocaleString()}`}
        </dt>
        <dd>{value.length === 0 ? 'Unavailable' : value}</dd>
      </div>
    )
  })
}

function formatShapeNumber(value: number): string {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: value < 1 ? 3 : 1,
  })
}
