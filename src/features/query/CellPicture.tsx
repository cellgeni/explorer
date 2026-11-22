import { useMemo, useState } from 'react'
import {
  MorphologyCanvas,
  type FlatMorphologyCanvasImage,
  type MorphologyCanvasChannel,
} from '../../components/MorphologyCanvas'
import type { ImagePyramidLoader } from '../../data/imagePyramid'
import type { MorphologyTileStore } from '../../rendering/morphologyTileStore'
import type { OverviewCellDatum } from '../../rendering/deckLayerTypes'
import {
  CELL_PICTURE_SIZE,
  CELL_PICTURE_TILE_CACHE_TILES,
  CELL_PICTURE_TILE_REQUESTS,
  cellPictureShape,
  cellPictureViewState,
  type CellPictureOutline,
} from './cellPictureModel'

// The image a picture is cut from: the canvas's channels, colours and
// contrast, or a flat Visium image.
export interface CellQueryPictureImage {
  readonly loader: ImagePyramidLoader | null
  readonly channels: readonly MorphologyCanvasChannel[]
  readonly flatImage: FlatMorphologyCanvasImage | null
}

// One row's picture (plan 23-D10): the image around the cell at the chosen
// field, drawn once its row has stopped moving (23-D12), with the cell's
// outline over it. Without an image the outline is drawn alone.
export function CellPicture({
  cell,
  field,
  spots = false,
  image,
  tileStore,
  priority,
  settled,
  outline,
  onTileError,
}: {
  readonly cell: OverviewCellDatum
  readonly field: number
  // Visium spots: their circle is their outline.
  readonly spots?: boolean
  readonly image: CellQueryPictureImage | null
  readonly tileStore: MorphologyTileStore
  // Lower is read first: rows higher in the table.
  readonly priority: number
  // The row has stopped moving.
  readonly settled: boolean
  // Undefined while it is read.
  readonly outline: CellPictureOutline | null | undefined
  readonly onTileError?: (error: Error) => void
}) {
  // Once read, a picture stays while its row is in view.
  const [requested, setRequested] = useState(settled)
  if (settled && !requested) setRequested(true)

  const viewState = useMemo(() => cellPictureViewState(cell, field), [cell, field])
  // Nothing while the outline is read, so a ring does not flash first.
  const shape =
    outline === undefined ? null : cellPictureShape(cell, outline, field, { spots })

  return (
    <div
      className="cell-query-picture"
      role="img"
      aria-label={`${cell.id}, ${field.toString()} µm across`}
      title={`${cell.id}, ${field.toString()} µm across`}
    >
      {requested && image !== null ? (
        <MorphologyCanvas
          loader={image.loader}
          channels={image.channels}
          flatImage={image.flatImage}
          viewState={viewState}
          maxConcurrentTileRequests={CELL_PICTURE_TILE_REQUESTS}
          tileCacheMaxTiles={CELL_PICTURE_TILE_CACHE_TILES}
          tileStore={tileStore}
          tilePriority={priority}
          {...(onTileError === undefined ? {} : { onTileError })}
        />
      ) : null}
      {shape === null ? null : (
        <svg
          className={
            shape.kind === 'circle' && shape.fallback
              ? 'cell-query-outline is-fallback'
              : 'cell-query-outline'
          }
          viewBox={`0 0 ${CELL_PICTURE_SIZE.toString()} ${CELL_PICTURE_SIZE.toString()}`}
          aria-hidden="true"
        >
          {shape.kind === 'path' ? (
            <path d={shape.d} />
          ) : (
            <circle cx={shape.cx} cy={shape.cy} r={shape.r} />
          )}
        </svg>
      )}
    </div>
  )
}
