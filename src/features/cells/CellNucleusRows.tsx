import { SQUARE_MICROMETERS } from '../../data/units'
import type { CellBoundaryDatum } from '../../rendering/deckLayers'
import { summarizeNucleusShapes } from './cellDetailModel'

// One row per nucleus drawn for the selected cell. Rows appear only while
// nucleus outlines are shown and loaded.
export function CellNucleusRows({
  nuclei,
}: {
  readonly nuclei: readonly CellBoundaryDatum[]
}) {
  const shapes = summarizeNucleusShapes(nuclei)

  return shapes.map((shape, index) => {
    const value = [
      shape.areaMicrometersSquared === undefined
        ? undefined
        : `${formatShapeNumber(shape.areaMicrometersSquared)} ${SQUARE_MICROMETERS}`,
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
