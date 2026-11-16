declare const micrometersBrand: unique symbol
declare const imagePixelsBrand: unique symbol
declare const screenPixelsBrand: unique symbol

export type Micrometers = number & { readonly [micrometersBrand]: true }
export type ImagePixels = number & { readonly [imagePixelsBrand]: true }
export type ScreenPixels = number & { readonly [screenPixelsBrand]: true }

export interface UnitsDescriptor {
  readonly dataUnit: 'micrometer'
  readonly imageUnit: 'pixel'
  readonly micrometersPerPixel: Micrometers
  readonly origin: 'top-left'
  readonly imageYAxis: 'down'
}

export interface DataPoint {
  readonly x: Micrometers
  readonly y: Micrometers
}

export interface DataVector {
  readonly x: Micrometers
  readonly y: Micrometers
}

export interface ScreenPoint {
  readonly x: ScreenPixels
  readonly y: ScreenPixels
}

export interface BBox {
  readonly minX: Micrometers
  readonly maxX: Micrometers
  readonly minY: Micrometers
  readonly maxY: Micrometers
}

export interface ViewportSize {
  readonly width: ScreenPixels
  readonly height: ScreenPixels
}

export interface OrthographicViewState {
  readonly target: readonly [Micrometers, Micrometers, number]
  readonly zoom: number
}

export interface TileGrid {
  readonly fullImageWidth?: ImagePixels
  readonly fullImageHeight?: ImagePixels
  readonly imageWidth: ImagePixels
  readonly imageHeight: ImagePixels
  readonly tileWidth: ImagePixels
  readonly tileHeight: ImagePixels
}

export interface TileIndex {
  readonly col: number
  readonly row: number
}

// One axis of a pyramid level's tile grid, placed in data micrometres.
export interface TileAxis {
  // Where the image starts on this axis.
  readonly origin: number
  // How far the image reaches from its origin. The unused part of a partial
  // last tile lies past it.
  readonly imageExtent: number
  // This level's micrometres per pixel along the axis.
  readonly micrometersPerPixel: number
  // Pixels per tile along the axis.
  readonly tileSize: number
  readonly tileCount: number
}

export function micrometers(value: number): Micrometers {
  assertFiniteNumber(value, 'micrometers')
  return value as Micrometers
}

export function imagePixels(value: number): ImagePixels {
  assertFiniteNumber(value, 'image pixels')
  return value as ImagePixels
}

export function screenPixels(value: number): ScreenPixels {
  assertFiniteNumber(value, 'screen pixels')
  return value as ScreenPixels
}

export function scaleFromZoom(zoom: number): number {
  assertFiniteNumber(zoom, 'zoom')
  return 2 ** zoom
}

export function micrometersToImagePixels(
  distance: Micrometers,
  units: UnitsDescriptor,
): ImagePixels {
  return imagePixels(distance / units.micrometersPerPixel)
}

export function imagePixelsToMicrometers(
  distance: ImagePixels,
  units: UnitsDescriptor,
): Micrometers {
  return micrometers(distance * units.micrometersPerPixel)
}

export function screenToData(
  point: ScreenPoint,
  viewState: OrthographicViewState,
  viewport: ViewportSize,
): DataPoint {
  const scale = scaleFromZoom(viewState.zoom)
  const offsetX = viewport.width / 2 - viewState.target[0] * scale
  const offsetY = viewport.height / 2 + viewState.target[1] * scale

  return {
    x: micrometers((point.x - offsetX) / scale),
    y: micrometers(-((point.y - offsetY) / scale)),
  }
}

export function dataToScreen(
  point: DataPoint,
  viewState: OrthographicViewState,
  viewport: ViewportSize,
): ScreenPoint {
  const scale = scaleFromZoom(viewState.zoom)
  const offsetX = viewport.width / 2 - viewState.target[0] * scale
  const offsetY = viewport.height / 2 + viewState.target[1] * scale

  return {
    x: screenPixels(point.x * scale + offsetX),
    y: screenPixels(-point.y * scale + offsetY),
  }
}

export function viewportBbox(
  viewState: OrthographicViewState,
  viewport: ViewportSize,
): BBox {
  const topLeft = screenToData(
    { x: screenPixels(0), y: screenPixels(0) },
    viewState,
    viewport,
  )
  const bottomRight = screenToData(
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

export function tileBounds(
  level: number,
  col: number,
  row: number,
  grid: TileGrid,
  units: UnitsDescriptor,
): BBox {
  const levelScale = units.micrometersPerPixel * 2 ** level
  const left = col * grid.tileWidth * levelScale
  const right = (col + 1) * grid.tileWidth * levelScale
  const bottom = row * grid.tileHeight * levelScale
  const top = (row + 1) * grid.tileHeight * levelScale
  const image = imageSizeMicrometers(level, grid, units)

  return {
    minX: micrometers(Math.max(0, left)),
    maxX: micrometers(Math.min(image.width, right)),
    minY: micrometers(Math.max(0, bottom)),
    maxY: micrometers(Math.min(image.height, top)),
  }
}

export function tilesForBbox(
  level: number,
  bbox: BBox,
  grid: TileGrid,
  units: UnitsDescriptor,
): readonly TileIndex[] {
  const levelScale = units.micrometersPerPixel * 2 ** level
  const image = imageSizeMicrometers(level, grid, units)

  return tilesForBboxOnAxes(
    bbox,
    {
      origin: 0,
      imageExtent: image.width,
      micrometersPerPixel: levelScale,
      tileSize: grid.tileWidth,
      tileCount: Math.ceil(grid.imageWidth / grid.tileWidth),
    },
    {
      origin: 0,
      imageExtent: image.height,
      micrometersPerPixel: levelScale,
      tileSize: grid.tileHeight,
      tileCount: Math.ceil(grid.imageHeight / grid.tileHeight),
    },
  )
}

// The tiles that a bbox meets on the image, row by row. A bbox that misses
// the image, or only touches its edge, gets none, as does one that only meets
// the unused part of a partial last tile. The image loaders call this with
// their own level scales, tile counts and origins.
export function tilesForBboxOnAxes(
  bbox: BBox,
  xAxis: TileAxis,
  yAxis: TileAxis,
): readonly TileIndex[] {
  const cols = tileSpan(bbox.minX, bbox.maxX, xAxis)
  const rows = tileSpan(bbox.minY, bbox.maxY, yAxis)
  const tiles: TileIndex[] = []

  if (cols === null || rows === null) {
    return tiles
  }

  for (let row = rows.first; row <= rows.last; row += 1) {
    for (let col = cols.first; col <= cols.last; col += 1) {
      tiles.push({ col, row })
    }
  }

  return tiles
}

// The first and last tile along one axis that [min, max] meets on the image,
// or null if it misses the image or only touches its edge. A span that ends
// on an edge between two tiles does not reach the second, but a zero-length
// span there still gets one tile.
function tileSpan(
  min: number,
  max: number,
  axis: TileAxis,
): { readonly first: number; readonly last: number } | null {
  if (axis.tileCount < 1) {
    return null
  }

  const start = min - axis.origin
  const end = max - axis.origin
  // Where both the image and this level's tiles reach. A level whose size was
  // rounded down can stop short of the image.
  const extent = Math.min(
    axis.imageExtent,
    axis.tileCount * axis.tileSize * axis.micrometersPerPixel,
  )

  if (!(start <= end && end > 0 && start < extent)) {
    return null
  }

  const lastTile = axis.tileCount - 1
  const first = Math.min(
    lastTile,
    Math.floor(Math.max(0, start / axis.micrometersPerPixel) / axis.tileSize),
  )
  const last = Math.floor(
    Math.max(0, Math.min(end, extent) / axis.micrometersPerPixel - 1e-9) / axis.tileSize,
  )

  return { first, last: Math.min(lastTile, Math.max(first, last)) }
}

// The full-resolution image size, or this level's size when the grid does not
// give it.
function imageSizeMicrometers(
  level: number,
  grid: TileGrid,
  units: UnitsDescriptor,
): { readonly width: number; readonly height: number } {
  const levelScale = 2 ** level

  return {
    width:
      (grid.fullImageWidth ?? grid.imageWidth * levelScale) * units.micrometersPerPixel,
    height:
      (grid.fullImageHeight ?? grid.imageHeight * levelScale) * units.micrometersPerPixel,
  }
}

function assertFiniteNumber(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be finite, received ${value}.`)
  }
}
