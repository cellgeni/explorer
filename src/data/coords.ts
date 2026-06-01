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
  readonly imageWidth: ImagePixels
  readonly imageHeight: ImagePixels
  readonly tileWidth: ImagePixels
  readonly tileHeight: ImagePixels
}

export interface TileIndex {
  readonly col: number
  readonly row: number
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
  const imageWidthMicrometers = grid.imageWidth * units.micrometersPerPixel
  const imageHeightMicrometers = grid.imageHeight * units.micrometersPerPixel

  return {
    minX: micrometers(Math.max(0, left)),
    maxX: micrometers(Math.min(imageWidthMicrometers, right)),
    minY: micrometers(Math.max(0, bottom)),
    maxY: micrometers(Math.min(imageHeightMicrometers, top)),
  }
}

export function tilesForBbox(
  level: number,
  bbox: BBox,
  grid: TileGrid,
  units: UnitsDescriptor,
): readonly TileIndex[] {
  const levelScale = units.micrometersPerPixel * 2 ** level
  const nCols = Math.ceil(grid.imageWidth / grid.tileWidth)
  const nRows = Math.ceil(grid.imageHeight / grid.tileHeight)
  const col0 = Math.max(
    0,
    Math.floor(Math.max(0, bbox.minX / levelScale) / grid.tileWidth),
  )
  const col1 = Math.min(
    nCols - 1,
    Math.floor(Math.max(0, bbox.maxX / levelScale - 1e-9) / grid.tileWidth),
  )
  const row0 = Math.max(
    0,
    Math.floor(Math.max(0, bbox.minY / levelScale) / grid.tileHeight),
  )
  const row1 = Math.min(
    nRows - 1,
    Math.floor(Math.max(0, bbox.maxY / levelScale - 1e-9) / grid.tileHeight),
  )

  const tiles: TileIndex[] = []

  for (let row = row0; row <= row1; row += 1) {
    for (let col = col0; col <= col1; col += 1) {
      tiles.push({ col, row })
    }
  }

  return tiles
}

function assertFiniteNumber(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be finite, received ${value}.`)
  }
}
