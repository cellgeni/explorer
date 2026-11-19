import {
  imagePixels,
  micrometers,
  type BBox,
  type ImageFramePlacement,
  type TileIndex,
} from '../data/coords'
import type { ImagePyramidTileFetchOptions } from '../data/imagePyramid'
import type { CellImageCell, CellImageLoader } from '../features/query/cellImageMeasurer'
import { openOmeZarrImageWithOptions } from '../zarr/omeZarrLoader'

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

export interface FakeOmeZarrCellImageOptions {
  // Level 0's pixels of each channel; each further level halves it, taking
  // the top-left pixel of each 2 x 2.
  readonly width: number
  readonly height: number
  readonly pixel: (x: number, y: number, channel: number) => number
  readonly channels?: number
  // The channel the loader reads.
  readonly channel?: number
  readonly levels?: number
  readonly chunkSize?: number
  // Channels per chunk: all of them when unset.
  readonly chunkChannels?: number
  readonly micrometersPerPixel?: number
  // Chunk keys left out, such as `0/0.1.0`: the fill value, 7.
  readonly missing?: readonly string[]
}

// A 16-bit uncompressed OME-Zarr v2 image in memory (c, y, x), its edge
// chunks padded with 9999 past the image.
export async function fakeOmeZarrCellImage(options: FakeOmeZarrCellImageOptions) {
  const channels = options.channels ?? 1
  const levels = options.levels ?? 1
  const chunkSize = options.chunkSize ?? 4
  const chunkChannels = options.chunkChannels ?? channels
  const mpp = options.micrometersPerPixel ?? 1
  const root = '/image.ome.zarr'
  const encoder = new TextEncoder()
  const json = (value: unknown) => encoder.encode(JSON.stringify(value))
  const files = new Map<string, Uint8Array>([
    [`${root}/.zgroup`, json({ zarr_format: 2 })],
    [
      `${root}/.zattrs`,
      json({
        multiscales: [
          {
            axes: [
              { name: 'c', type: 'channel' },
              { name: 'y', type: 'space', unit: 'micrometer' },
              { name: 'x', type: 'space', unit: 'micrometer' },
            ],
            datasets: Array.from({ length: levels }, (_, level) => ({
              path: level.toString(),
              coordinateTransformations: [
                { type: 'scale', scale: [1, mpp * 2 ** level, mpp * 2 ** level] },
              ],
            })),
          },
        ],
      }),
    ],
  ])

  for (let level = 0; level < levels; level += 1) {
    const width = Math.ceil(options.width / 2 ** level)
    const height = Math.ceil(options.height / 2 ** level)
    files.set(
      `${root}/${level.toString()}/.zarray`,
      json({
        zarr_format: 2,
        shape: [channels, height, width],
        chunks: [chunkChannels, chunkSize, chunkSize],
        dtype: '<u2',
        compressor: null,
        fill_value: 7,
        order: 'C',
        filters: null,
        dimension_separator: '.',
      }),
    )

    for (let c = 0; c < Math.ceil(channels / chunkChannels); c += 1) {
      for (let row = 0; row < Math.ceil(height / chunkSize); row += 1) {
        for (let col = 0; col < Math.ceil(width / chunkSize); col += 1) {
          const key = `${level.toString()}/${[c, row, col].join('.')}`
          if (options.missing?.includes(key) === true) continue
          const values = new Uint16Array(chunkChannels * chunkSize * chunkSize)
          values.forEach((_, index) => {
            const channel = c * chunkChannels + Math.floor(index / chunkSize ** 2)
            const x = col * chunkSize + (index % chunkSize)
            const y = row * chunkSize + (Math.floor(index / chunkSize) % chunkSize)
            values[index] =
              x < width && y < height && channel < channels
                ? options.pixel(x * 2 ** level, y * 2 ** level, channel)
                : 9999
          })
          files.set(`${root}/${key}`, new Uint8Array(values.buffer))
        }
      }
    }
  }

  const requests: string[] = []
  const fetcher = (async (input: RequestInfo | URL) => {
    const path = new URL(input instanceof Request ? input.url : String(input)).pathname
    requests.push(path)
    const bytes = files.get(path)
    return bytes === undefined
      ? new Response(null, { status: 404 })
      : new Response(bytes.slice().buffer)
  }) as typeof fetch
  const channel = options.channel ?? 0
  const loader = await openOmeZarrImageWithOptions(
    `https://example.test${root}${channel === 0 ? '' : `#c=${channel.toString()}`}`,
    { fetcher, decodePool: null },
  )

  // Chunk reads alone, as `level/c.y.x`.
  const chunkReads = () =>
    requests
      .filter((path) => /\/\d+\/\d+\.\d+\.\d+$/.test(path))
      .map((path) => path.slice(root.length + 1))
  return { loader, chunkReads }
}

// A cell drawn at dataset (x, y): deck.gl's y is negated.
export function cell(x: number, y: number, cellArea?: number): CellImageCell {
  return { position: [x, -y], ...(cellArea === undefined ? {} : { cellArea }) }
}
