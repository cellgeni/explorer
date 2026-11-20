import type { Position } from '@deck.gl/core'
import type { TiffTileDecodeMetadata } from '../../codecs/tiffTile'
import type { ImageFramePlacement, TileIndex } from '../../data/coords'
import type { ImagePyramidChunkRead, ImagePyramidLoader } from '../../data/imagePyramid'
import type { TileCellSums } from '../../data/tileCellMeasure'
import { TileRequestSlots } from '../../tiff/tileRequestScheduler'
import type { TileMeasure } from '../../workers/tileDecodeMessages'
import { TileDecodeWorkerPool } from '../../workers/tileDecodePool'
import { ZarrDecodePool } from '../../workers/zarrDecodePool'

// Measures one image channel under every cell (plan 26): the mean of each
// cell's pixels, and the share of them at or above a threshold, at one
// pyramid level. Cells are discs (26-D4). The main thread buckets the cells
// by tile and fetches the tiles; workers decode and sum them per cell; the
// sums are added up here. An OME-Zarr image is read chunk by chunk instead of
// tile by tile, so that each chunk is fetched and decoded once.

export type CellImageLoader = Pick<
  ImagePyramidLoader,
  | 'numLevels'
  | 'tileWidth'
  | 'tileHeight'
  | 'placement'
  | 'tilesForLevel'
  | 'tileBounds'
  | 'tileSourceSize'
  | 'fetchTileBytes'
  | 'tileDecodeOptions'
  | 'tileReadBytes'
  | 'chunkGrid'
  | 'readChunk'
>

// What a measurement needs of a cell: its position as drawn (micrometres,
// y negated) and its area where the platform gives one.
export interface CellImageCell {
  readonly position: Position
  readonly cellArea?: number
}

export interface CellImageLevel {
  readonly level: number
  readonly micrometersPerPixel: number
}

// The level a measurement reads unless another is chosen (26-D5): two steps
// coarser than full resolution, or the coarsest of an image with fewer.
export const DEFAULT_CELL_IMAGE_LEVEL = 2
// The disc's radius for cells without an area, in micrometres (26-D4).
export const DEFAULT_CELL_IMAGE_RADIUS = 5
// Tiles read and measured at once, and requests in flight across every
// measurement: an HTTP/1.1 host allows 6 connections (26, spike).
const TILES_IN_FLIGHT = 12
// Chunks can be far larger than tiles (4096² in SpatialData images), so
// fewer are read at once: as many as fit in this many bytes decoded, and at
// least two.
const CHUNK_BYTES_IN_FLIGHT = 256 * 1024 ** 2
export const CELL_IMAGE_REQUEST_SLOTS = 6
// Tiles named as coming next to each fetch, which a TIFF loader reads in the
// same request when they are stored beside it.
const UPCOMING_TILES = 8

// The read budget (26-D7), per channel.
export const CELL_IMAGE_ASK_BYTES = 1024 ** 3
export const CELL_IMAGE_REFUSE_BYTES = 8 * 1024 ** 3

export type CellImageReadDecision = 'measure' | 'ask' | 'refuse'

export function cellImageReadDecision(bytes: number): CellImageReadDecision {
  if (bytes > CELL_IMAGE_REFUSE_BYTES) return 'refuse'
  return bytes > CELL_IMAGE_ASK_BYTES ? 'ask' : 'measure'
}

// A loader whose tiles (TIFF) or chunks (OME-Zarr) can be measured.
export function canMeasureCellImage(loader: ImagePyramidLoader): boolean {
  return (
    (loader.fetchTileBytes !== undefined && loader.tileDecodeOptions !== undefined) ||
    (loader.chunkGrid !== undefined && loader.readChunk !== undefined)
  )
}

export function defaultCellImageLevel(
  loader: Pick<ImagePyramidLoader, 'numLevels'>,
): number {
  return Math.max(0, Math.min(DEFAULT_CELL_IMAGE_LEVEL, loader.numLevels - 1))
}

// Every level, finest first, with its pixel size.
export function cellImageLevels(loader: CellImageLoader): readonly CellImageLevel[] {
  return Array.from({ length: loader.numLevels }, (_, level) => ({
    level,
    micrometersPerPixel: levelGeometry(loader, level).micrometersPerPixel,
  }))
}

interface LevelGeometry {
  readonly originX: number
  readonly originY: number
  readonly micrometersPerPixel: number
  readonly micrometersPerPixelY: number
  readonly width: number
  readonly height: number
  // The pieces a measurement reads: the loader's tiles, or its chunks.
  readonly tileWidth: number
  readonly tileHeight: number
  readonly cols: number
  readonly rows: number
  // A chunk's size decoded, when the pieces are chunks.
  readonly chunkBytes: number | null
}

function levelGeometry(loader: CellImageLoader, level: number): LevelGeometry {
  const first = loader.tileBounds(level, 0, 0)
  const firstSize = loader.tileSourceSize(level, 0, 0)
  let tileCols = 0
  let tileRows = 0

  for (const tile of loader.tilesForLevel(level)) {
    tileCols = Math.max(tileCols, tile.col + 1)
    tileRows = Math.max(tileRows, tile.row + 1)
  }

  // Every tile but the last of a row or column is whole.
  const width =
    tileCols === 0
      ? 0
      : (tileCols - 1) * firstSize.width +
        loader.tileSourceSize(level, tileCols - 1, 0).width
  const height =
    tileRows === 0
      ? 0
      : (tileRows - 1) * firstSize.height +
        loader.tileSourceSize(level, 0, tileRows - 1).height
  const placed = {
    originX: first.minX,
    originY: first.minY,
    micrometersPerPixel: (first.maxX - first.minX) / Math.max(1, firstSize.width),
    micrometersPerPixelY: (first.maxY - first.minY) / Math.max(1, firstSize.height),
    width,
    height,
  }
  const chunks = loader.readChunk === undefined ? undefined : loader.chunkGrid?.(level)

  if (chunks !== undefined) {
    return {
      ...placed,
      tileWidth: chunks.chunkWidth,
      tileHeight: chunks.chunkHeight,
      cols: Math.ceil(width / chunks.chunkWidth),
      rows: Math.ceil(height / chunks.chunkHeight),
      chunkBytes: chunks.chunkBytes,
    }
  }

  return {
    ...placed,
    tileWidth: loader.tileWidth,
    tileHeight: loader.tileHeight,
    cols: tileCols,
    rows: tileRows,
    chunkBytes: null,
  }
}

// The cells bucketed by the tiles their discs touch, at one level. A disc
// across a tile edge is in each tile; tiles without cells are not read.
export interface CellImagePlan {
  readonly level: number
  // The pieces read, in the level's pixels: tiles, or chunks when
  // `chunkBytes` is set, with a chunk's size decoded.
  readonly tileWidth: number
  readonly tileHeight: number
  readonly chunkBytes: number | null
  readonly cellCount: number
  // Cells whose discs miss the image; they get no value.
  readonly cellsOutside: number
  // In read order: row by row, as TIFF tiles are usually stored, so that
  // neighbours share requests. Columns and rows of the pieces read.
  readonly tiles: readonly TileIndex[]
  // Each cell's disc in the level's pixels, the radius in pixel widths.
  readonly x: Float64Array
  readonly y: Float64Array
  readonly radius: Float64Array
  // A pixel's height over its width. Discs are round in micrometres, so on
  // pixels that are not square they reach radius / yScale pixels down.
  readonly yScale: number
  // The cells of tiles[i] are rows[starts[i]] up to rows[starts[i + 1]], in
  // the overview's order, so the lower row takes a pixel on a tie.
  readonly starts: Uint32Array
  readonly rows: Uint32Array
}

// `radius` (micrometres) is for cells without an area (26-D4).
export function planCellImageMeasurement(
  loader: CellImageLoader,
  cells: readonly CellImageCell[],
  level: number,
  radius: number,
): CellImagePlan {
  const geometry = levelGeometry(loader, level)
  const { cols, rows, width, height, tileWidth, tileHeight } = geometry
  const cellCount = cells.length
  const x = new Float64Array(cellCount)
  const y = new Float64Array(cellCount)
  const radii = new Float64Array(cellCount)
  const yScale = geometry.micrometersPerPixelY / geometry.micrometersPerPixel
  const toFrame = frameMapping(loader.placement)

  for (let cell = 0; cell < cellCount; cell += 1) {
    const datum = cells[cell]
    const [dataX = Number.NaN, deckY = Number.NaN] = datum?.position ?? []
    const [frameX, frameY] = toFrame(dataX, -deckY)
    const area = datum?.cellArea
    const micrometres =
      area !== undefined && area > 0 ? Math.sqrt(area / Math.PI) : radius
    x[cell] = (frameX - geometry.originX) / geometry.micrometersPerPixel
    y[cell] = (frameY - geometry.originY) / geometry.micrometersPerPixelY
    radii[cell] = micrometres / geometry.micrometersPerPixel
  }

  // Each cell's tiles, as a range of columns and rows; none for a disc that
  // misses the level.
  const tileCounts = new Uint32Array(cols * rows)
  const forEachTile = (cell: number, visit: (tile: number) => void): boolean => {
    const cx = x[cell] ?? 0
    const cy = y[cell] ?? 0
    const r = radii[cell] ?? 0
    const ry = r / yScale

    if (!(r > 0) || !Number.isFinite(cx + cy + r + ry)) return false

    const x0 = Math.max(0, Math.ceil(cx - r - 0.5))
    const x1 = Math.min(width - 1, Math.floor(cx + r - 0.5))
    const y0 = Math.max(0, Math.ceil(cy - ry - 0.5))
    const y1 = Math.min(height - 1, Math.floor(cy + ry - 0.5))

    if (x0 > x1 || y0 > y1) return false

    const lastRow = Math.floor(y1 / tileHeight)
    const lastCol = Math.floor(x1 / tileWidth)

    for (let row = Math.floor(y0 / tileHeight); row <= lastRow; row += 1) {
      for (let col = Math.floor(x0 / tileWidth); col <= lastCol; col += 1) {
        visit(row * cols + col)
      }
    }

    return true
  }
  let cellsOutside = 0

  for (let cell = 0; cell < cellCount; cell += 1) {
    const inside = forEachTile(cell, (tile) => {
      tileCounts[tile] = (tileCounts[tile] ?? 0) + 1
    })
    if (!inside) cellsOutside += 1
  }

  const tiles: TileIndex[] = []
  const tileSlots = new Int32Array(cols * rows).fill(-1)
  let entries = 0

  for (let tile = 0; tile < cols * rows; tile += 1) {
    const count = tileCounts[tile] ?? 0
    if (count === 0) continue
    tileSlots[tile] = tiles.length
    tiles.push({ col: tile % cols, row: Math.floor(tile / cols) })
    entries += count
  }

  const starts = new Uint32Array(tiles.length + 1)
  tiles.forEach((tile, index) => {
    starts[index + 1] =
      (starts[index] ?? 0) + (tileCounts[tile.row * cols + tile.col] ?? 0)
  })
  const filled = starts.slice(0, tiles.length)
  const bucketRows = new Uint32Array(entries)

  for (let cell = 0; cell < cellCount; cell += 1) {
    forEachTile(cell, (tile) => {
      const slot = tileSlots[tile] ?? -1
      if (slot < 0) return
      bucketRows[filled[slot] ?? 0] = cell
      filled[slot] = (filled[slot] ?? 0) + 1
    })
  }

  return {
    level,
    tileWidth,
    tileHeight,
    chunkBytes: geometry.chunkBytes,
    cellCount,
    cellsOutside,
    tiles,
    x,
    y,
    radius: radii,
    yScale,
    starts,
    rows: bucketRows,
  }
}

// Dataset micrometres to the loader's frame: the placement's inverse, a
// signed permutation's transpose.
function frameMapping(
  placement: ImageFramePlacement | undefined,
): (x: number, y: number) => readonly [number, number] {
  if (placement === undefined) return (x, y) => [x, y]
  const { a, b, c, d, e, f } = placement
  return (x, y) => [a * (x - c) + d * (y - f), b * (x - c) + e * (y - f)]
}

// What a measurement reads: exact from a TIFF's tile index, otherwise at
// most each tile's or chunk's size decoded, as compressed data is smaller.
export interface CellImageReadSize {
  readonly bytes: number
  readonly exact: boolean
}

export async function cellImageReadBytes(
  loader: CellImageLoader,
  plan: CellImagePlan,
  signal?: AbortSignal,
): Promise<CellImageReadSize> {
  if (plan.chunkBytes !== null) {
    return { bytes: plan.tiles.length * plan.chunkBytes, exact: false }
  }

  const exact = (await loader.tileReadBytes?.(plan.level, plan.tiles, signal)) ?? null
  if (exact !== null) return { bytes: exact, exact: true }

  const bits = loader.tileDecodeOptions?.(plan.level)?.bitsPerSample?.[0] ?? 16
  return {
    bytes: plan.tiles.length * plan.tileWidth * plan.tileHeight * Math.ceil(bits / 8),
    exact: false,
  }
}

// What measuring a whole level would read, for the Resolution list (26-D5);
// null when the loader cannot tell.
export async function cellImageLevelReadSize(
  loader: CellImageLoader,
  level: number,
  signal?: AbortSignal,
): Promise<CellImageReadSize | null> {
  const geometry = levelGeometry(loader, level)

  if (geometry.chunkBytes !== null) {
    return {
      bytes: geometry.cols * geometry.rows * geometry.chunkBytes,
      exact: false,
    }
  }

  const bytes =
    (await loader.tileReadBytes?.(level, loader.tilesForLevel(level), signal)) ?? null
  return bytes === null ? null : { bytes, exact: true }
}

export type CellImageTileMeasure = (
  bytes: Uint8Array,
  metadata: TiffTileDecodeMetadata,
  measure: TileMeasure,
) => Promise<TileCellSums>

export type CellImageChunkMeasure = (
  chunk: ImagePyramidChunkRead,
  measure: TileMeasure,
) => Promise<TileCellSums>

export interface CellImageMeasurement {
  // Per overview row; NaN for a cell with no pixels, such as one outside
  // the image.
  readonly mean: Float64Array
  // Percent of the cell's pixels at or above the threshold.
  readonly above: Float64Array
  readonly cellsOutside: number
  readonly tiles: number
  readonly bytes: number
}

export interface RunCellImageMeasurementOptions {
  readonly threshold: number
  readonly measureTile: CellImageTileMeasure
  // For a plan that reads chunks.
  readonly measureChunk?: CellImageChunkMeasure
  readonly signal?: AbortSignal
  // Shared by the measurements running at once.
  readonly slots?: TileRequestSlots
  // Tiles measured so far, after each tile.
  readonly onProgress?: (tilesDone: number, bytesRead: number) => void
}

export async function runCellImageMeasurement(
  loader: CellImageLoader,
  plan: CellImagePlan,
  options: RunCellImageMeasurementOptions,
): Promise<CellImageMeasurement> {
  const fetchTileBytes = loader.fetchTileBytes?.bind(loader)
  const tileDecodeOptions = loader.tileDecodeOptions?.bind(loader)
  const readChunk = loader.readChunk?.bind(loader)
  const { measureChunk } = options
  const chunked = plan.chunkBytes !== null

  if (
    chunked
      ? readChunk === undefined || measureChunk === undefined
      : fetchTileBytes === undefined || tileDecodeOptions === undefined
  ) {
    throw new Error("This image's tiles cannot be measured yet.")
  }

  const { level, tiles } = plan
  const slots = options.slots ?? new TileRequestSlots(CELL_IMAGE_REQUEST_SLOTS)
  // Stops the other tiles once one fails, as well as on the caller's abort.
  const controller = new AbortController()
  const signal = controller.signal
  const stop = () => {
    controller.abort(options.signal?.reason)
  }
  options.signal?.addEventListener('abort', stop, { once: true })
  if (options.signal?.aborted === true) stop()

  const sum = new Float64Array(plan.cellCount)
  const count = new Uint32Array(plan.cellCount)
  const above = new Uint32Array(plan.cellCount)
  let next = 0
  let done = 0
  let bytesRead = 0
  const lanes =
    plan.chunkBytes === null
      ? TILES_IN_FLIGHT
      : Math.max(
          2,
          Math.min(
            TILES_IN_FLIGHT,
            Math.floor(CHUNK_BYTES_IN_FLIGHT / Math.max(1, plan.chunkBytes)),
          ),
        )

  // Fetches a piece under a request slot.
  const read = async <T>(fetch: (release: () => void) => Promise<T>): Promise<T> => {
    const release = await takeSlot(slots, signal)
    try {
      return await fetch(release)
    } finally {
      release()
    }
  }

  // Reads and measures one piece, the cells given in its pixels.
  const measurePiece = async (index: number, cells: TileMeasure['cells']) => {
    const tile = tiles[index] ?? { col: 0, row: 0 }

    if (chunked && readChunk !== undefined && measureChunk !== undefined) {
      const chunk = await read(() => readChunk(level, tile.col, tile.row, signal))
      bytesRead += chunk.bytes?.byteLength ?? 0
      signal.throwIfAborted()
      return measureChunk(chunk, {
        cells,
        width: chunk.window.width,
        height: chunk.window.height,
        threshold: options.threshold,
        yScale: plan.yScale,
      })
    }

    if (fetchTileBytes === undefined || tileDecodeOptions === undefined) {
      throw new Error("This image's tiles cannot be measured yet.")
    }

    const bytes = await read((release) =>
      fetchTileBytes(level, tile.col, tile.row, signal, {
        upcoming: tiles.slice(index + 1, index + 1 + UPCOMING_TILES),
        onSharedRead: release,
        persist: false,
      }),
    )
    bytesRead += bytes.byteLength
    signal.throwIfAborted()
    const size = loader.tileSourceSize(level, tile.col, tile.row)
    return options.measureTile(bytes, tileDecodeOptions(level, tile.col, tile.row), {
      cells,
      width: size.width,
      height: size.height,
      threshold: options.threshold,
      yScale: plan.yScale,
    })
  }

  const measureTile = async (index: number): Promise<void> => {
    const tile = tiles[index]
    const start = plan.starts[index] ?? 0
    const end = plan.starts[index + 1] ?? start
    if (tile === undefined || end === start) return

    const offsetX = tile.col * plan.tileWidth
    const offsetY = tile.row * plan.tileHeight
    const cells = {
      x: new Float32Array(end - start),
      y: new Float32Array(end - start),
      radius: new Float32Array(end - start),
    }

    for (let entry = start; entry < end; entry += 1) {
      const cell = plan.rows[entry] ?? 0
      cells.x[entry - start] = (plan.x[cell] ?? 0) - offsetX
      cells.y[entry - start] = (plan.y[cell] ?? 0) - offsetY
      cells.radius[entry - start] = plan.radius[cell] ?? 0
    }

    const sums = await measurePiece(index, cells)
    signal.throwIfAborted()

    for (let entry = start; entry < end; entry += 1) {
      const cell = plan.rows[entry] ?? 0
      const at = entry - start
      sum[cell] = (sum[cell] ?? 0) + (sums.sum[at] ?? 0)
      count[cell] = (count[cell] ?? 0) + (sums.count[at] ?? 0)
      above[cell] = (above[cell] ?? 0) + (sums.above[at] ?? 0)
    }
  }

  const lane = async (): Promise<void> => {
    while (next < tiles.length) {
      const index = next
      next += 1

      try {
        await measureTile(index)
      } catch (error) {
        if (signal.aborted) throw error
        // Once more before giving up: a dropped connection is common.
        await measureTile(index)
      }

      done += 1
      options.onProgress?.(done, bytesRead)
    }
  }

  try {
    await Promise.all(
      Array.from({ length: Math.min(lanes, tiles.length) }, () =>
        lane().catch((error: unknown) => {
          stop()
          throw error
        }),
      ),
    )
  } catch (error) {
    options.signal?.throwIfAborted()
    throw new Error(
      `The image's tiles could not be read: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  } finally {
    options.signal?.removeEventListener('abort', stop)
  }

  const mean = new Float64Array(plan.cellCount)
  const share = new Float64Array(plan.cellCount)

  for (let cell = 0; cell < plan.cellCount; cell += 1) {
    const pixels = count[cell] ?? 0
    mean[cell] = pixels === 0 ? Number.NaN : (sum[cell] ?? 0) / pixels
    share[cell] = pixels === 0 ? Number.NaN : ((above[cell] ?? 0) * 100) / pixels
  }

  return {
    mean,
    above: share,
    cellsOutside: plan.cellsOutside,
    tiles: tiles.length,
    bytes: bytesRead,
  }
}

// A request slot, given back by the returned function (once, however often
// it is called).
function takeSlot(slots: TileRequestSlots, signal: AbortSignal): Promise<() => void> {
  return new Promise((resolve, reject) => {
    let released = false
    const release = () => {
      if (released) return
      released = true
      slots.give()
    }
    const onAbort = () => {
      reject(signal.reason instanceof Error ? signal.reason : abortError())
    }
    const attempt = () => {
      if (signal.aborted) return
      if (!slots.take(attempt)) return
      signal.removeEventListener('abort', onAbort)
      resolve(release)
    }

    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    attempt()
  })
}

function abortError(): DOMException {
  return new DOMException('The measurement was cancelled.', 'AbortError')
}

// Decodes and measures tiles and chunks in pools of workers of their own, so
// the canvas's keep decoding (26, How A Measurement Runs, 5); on this thread
// where there are no workers.
export interface CellImageTileMeasurer {
  readonly measure: CellImageTileMeasure
  readonly measureChunk: CellImageChunkMeasure
  close(): void
}

export function createCellImageTileMeasurer(): CellImageTileMeasurer {
  if (typeof Worker === 'undefined') {
    return {
      measure: async (bytes, metadata, measure) => {
        const { measureTileBytes } = await import('../../workers/tileMeasureCore')
        return measureTileBytes(bytes, metadata, measure)
      },
      measureChunk: async (chunk, measure) => {
        const { measureChunkCells } = await import('../../workers/zarrDecodeCore')
        return measureChunkCells(
          chunk.source,
          chunk.bytes === undefined ? null : chunk.bytes.slice().buffer,
          chunk.window,
          measure,
        )
      },
      close: () => undefined,
    }
  }

  const cores = navigator.hardwareConcurrency ?? 2
  const size = Math.min(4, Math.max(1, cores - 2))
  // Workers start with the first tile or chunk each pool is sent.
  const tiles = new TileDecodeWorkerPool({ size })
  const chunks = new ZarrDecodePool({ size })
  return {
    measure: (bytes, metadata, measure) => tiles.measure(bytes, metadata, measure),
    measureChunk: (chunk, measure) => chunks.measureChunk({ ...chunk, measure }),
    close: () => {
      tiles.terminate()
      chunks.terminate()
    },
  }
}
