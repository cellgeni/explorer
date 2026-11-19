import {
  imagePixels,
  micrometers,
  type BBox,
  type ImageFramePlacement,
  type TileIndex,
} from '../data/coords'
import type { ImagePyramidTileFetchOptions } from '../data/imagePyramid'
import type { CellImageCell, CellImageLoader } from '../features/query/cellImageMeasurer'

// An image in memory for Cell Query's image measurements (plan 26).

export interface FakeCellImageOptions {
  // Pixels of level 0, row by row; each further level halves it, taking
  // the top-left pixel of each 2 x 2.
  readonly width: number
  readonly height: number
  readonly pixel: (x: number, y: number) => number
  readonly levels?: number
  readonly tileSize?: number
  readonly micrometersPerPixel?: number
  readonly origin?: { readonly x: number; readonly y: number }
  readonly placement?: ImageFramePlacement
  readonly fail?: (tile: TileIndex, attempt: number) => boolean
}

// A 16-bit uncompressed TIFF in memory, tiles padded to the full tile size.
export function fakeCellImage(options: FakeCellImageOptions) {
  const tileSize = options.tileSize ?? 4
  const levels = options.levels ?? 1
  const mpp = options.micrometersPerPixel ?? 1
  const origin = options.origin ?? { x: 0, y: 0 }
  const fetches: {
    tile: TileIndex & { level: number }
    options?: ImagePyramidTileFetchOptions
  }[] = []
  const attempts = new Map<string, number>()
  const levelSize = (level: number) => ({
    width: Math.ceil(options.width / 2 ** level),
    height: Math.ceil(options.height / 2 ** level),
  })
  const grid = (level: number) => {
    const size = levelSize(level)
    return {
      cols: Math.ceil(size.width / tileSize),
      rows: Math.ceil(size.height / tileSize),
    }
  }

  const loader: CellImageLoader = {
    numLevels: levels,
    tileWidth: imagePixels(tileSize),
    tileHeight: imagePixels(tileSize),
    ...(options.placement === undefined ? {} : { placement: options.placement }),
    tilesForLevel(level) {
      const { cols, rows } = grid(level)
      return Array.from({ length: cols * rows }, (_, index) => ({
        col: index % cols,
        row: Math.floor(index / cols),
      }))
    },
    tileBounds(level, col, row): BBox {
      const scale = mpp * 2 ** level
      const size = this.tileSourceSize(level, col, row)
      return {
        minX: micrometers(origin.x + col * tileSize * scale),
        minY: micrometers(origin.y + row * tileSize * scale),
        maxX: micrometers(origin.x + (col * tileSize + size.width) * scale),
        maxY: micrometers(origin.y + (row * tileSize + size.height) * scale),
      }
    },
    tileSourceSize(level, col, row) {
      const size = levelSize(level)
      return {
        width: imagePixels(Math.min(tileSize, size.width - col * tileSize)),
        height: imagePixels(Math.min(tileSize, size.height - row * tileSize)),
      }
    },
    async fetchTileBytes(level, col, row, signal, fetchOptions) {
      signal?.throwIfAborted()
      fetches.push({
        tile: { level, col, row },
        ...(fetchOptions === undefined ? {} : { options: fetchOptions }),
      })
      const key = `${level}/${col}/${row}`
      const attempt = (attempts.get(key) ?? 0) + 1
      attempts.set(key, attempt)
      if (options.fail?.({ col, row }, attempt) === true)
        throw new Error(`Tile ${key} failed`)
      const size = levelSize(level)
      const values = new Uint16Array(tileSize * tileSize)
      for (let y = 0; y < tileSize; y += 1) {
        for (let x = 0; x < tileSize; x += 1) {
          const levelX = col * tileSize + x
          const levelY = row * tileSize + y
          values[y * tileSize + x] =
            levelX < size.width && levelY < size.height
              ? options.pixel(levelX * 2 ** level, levelY * 2 ** level)
              : 9999
        }
      }
      return new Uint8Array(values.buffer)
    },
    tileDecodeOptions: () => ({
      compression: 1,
      bitsPerSample: [16],
      samplesPerPixel: 1,
      tileWidth: tileSize,
      tileHeight: tileSize,
      littleEndian: true,
    }),
  }

  return { loader, fetches }
}

// A cell drawn at dataset (x, y): deck.gl's y is negated.
export function cell(x: number, y: number, cellArea?: number): CellImageCell {
  return { position: [x, -y], ...(cellArea === undefined ? {} : { cellArea }) }
}
