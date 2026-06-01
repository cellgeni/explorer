import { micrometers, scaleFromZoom } from '../data/coords'
import type { BBox } from '../data/coords'
import type { TileIndex } from '../data/coords'
import type { ReadyTile } from '../tiff/tileCache'
import type { OverviewViewState } from './deckLayers'

export interface CssViewportSize {
  readonly width: number
  readonly height: number
}

export interface ScreenCoordinate {
  readonly x: number
  readonly y: number
}

export function morphologyViewportBbox(
  viewState: OverviewViewState,
  viewport: CssViewportSize,
): BBox {
  const topLeft = screenToRawData({ x: 0, y: 0 }, viewState, viewport)
  const bottomRight = screenToRawData(
    { x: viewport.width, y: viewport.height },
    viewState,
    viewport,
  )

  return {
    minX: micrometers(Math.min(topLeft.x, bottomRight.x)),
    maxX: micrometers(Math.max(topLeft.x, bottomRight.x)),
    minY: micrometers(Math.min(topLeft.y, bottomRight.y)),
    maxY: micrometers(Math.max(topLeft.y, bottomRight.y)),
  }
}

export function drawMorphologyTiles(
  context: CanvasRenderingContext2D,
  tiles: readonly ReadyTile[],
  viewState: OverviewViewState,
  viewport: CssViewportSize,
): void {
  context.clearRect(0, 0, viewport.width, viewport.height)

  for (const tile of tiles) {
    const topLeft = deckDataToScreen(
      { x: tile.bounds.minX, y: -tile.bounds.minY },
      viewState,
      viewport,
    )
    const bottomRight = deckDataToScreen(
      { x: tile.bounds.maxX, y: -tile.bounds.maxY },
      viewState,
      viewport,
    )
    const width = bottomRight.x - topLeft.x
    const height = bottomRight.y - topLeft.y

    if (width <= 0 || height <= 0) {
      continue
    }

    context.drawImage(
      tile.image,
      0,
      0,
      tile.sourceWidth,
      tile.sourceHeight,
      topLeft.x,
      topLeft.y,
      width,
      height,
    )
  }
}

export function selectCenteredTiles(
  tiles: readonly TileIndex[],
  maxTiles: number,
  bbox: BBox,
  tileBounds: (tile: TileIndex) => BBox,
): readonly TileIndex[] {
  if (maxTiles <= 0) {
    return []
  }

  const centerX = (bbox.minX + bbox.maxX) / 2
  const centerY = (bbox.minY + bbox.maxY) / 2

  return tiles
    .map((tile, index) => {
      const bounds = tileBounds(tile)
      const tileCenterX = (bounds.minX + bounds.maxX) / 2
      const tileCenterY = (bounds.minY + bounds.maxY) / 2
      const dx = tileCenterX - centerX
      const dy = tileCenterY - centerY

      return {
        tile,
        index,
        distanceSquared: dx * dx + dy * dy,
      }
    })
    .sort((a, b) => a.distanceSquared - b.distanceSquared || a.index - b.index)
    .slice(0, maxTiles)
    .map(({ tile }) => tile)
}

function screenToRawData(
  point: ScreenCoordinate,
  viewState: OverviewViewState,
  viewport: CssViewportSize,
): ScreenCoordinate {
  const scale = scaleFromZoom(viewState.zoom)
  const offsetX = viewport.width / 2 - viewState.target[0] * scale
  const offsetY = viewport.height / 2 + viewState.target[1] * scale
  const deckY = -((point.y - offsetY) / scale)

  return {
    x: (point.x - offsetX) / scale,
    y: -deckY,
  }
}

function deckDataToScreen(
  point: ScreenCoordinate,
  viewState: OverviewViewState,
  viewport: CssViewportSize,
): ScreenCoordinate {
  const scale = scaleFromZoom(viewState.zoom)
  const offsetX = viewport.width / 2 - viewState.target[0] * scale
  const offsetY = viewport.height / 2 + viewState.target[1] * scale

  return {
    x: point.x * scale + offsetX,
    y: -point.y * scale + offsetY,
  }
}
