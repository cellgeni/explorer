import { describe, expect, it, vi } from 'vitest'
import { imagePixels } from './coords'
import { computeChannelAutoContrast, spreadTiles } from './morphologyContrast'
import type { DecodedJpeg2000 } from '../codecs/jpeg2000'
import type {
  TileDecodeResponse,
  TileDecodeWorkerRequest,
  TileSamplesRequest,
} from '../workers/tileDecodeMessages'
import type { DecodeWorkerLike } from '../workers/tileDecodePool'
import { handleTileSamplesRequest } from '../workers/tileSamplesCore'
import type { AutoContrastTileLoader } from './morphologyContrast'
import { sampleDecodedTile, type TileSampling } from './tileSamples'

// Runs the real samples handler behind a structured-clone boundary, as the
// tile decode worker does.
class SamplingTileWorker implements DecodeWorkerLike {
  onmessage: ((event: MessageEvent<TileDecodeResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly requests: TileSamplesRequest[] = []
  terminated = false

  postMessage(message: TileDecodeWorkerRequest): void {
    if (!('sampling' in message)) {
      throw new Error('Expected a samples request.')
    }

    this.requests.push(message)
    this.handle(message)
  }

  protected handle(message: TileSamplesRequest): void {
    void handleTileSamplesRequest(structuredClone(message), (response, transfer) => {
      const data = structuredClone(response, { transfer })
      queueMicrotask(() => {
        if (!this.terminated) {
          this.onmessage?.(new MessageEvent('message', { data }))
        }
      })
    })
  }

  terminate(): void {
    this.terminated = true
  }
}

// Never answers.
class SilentTileWorker extends SamplingTileWorker {
  protected override handle(): void {}
}

// Three uncompressed 8-bit 4 x 2 tiles with a visible area of 3 x 2; the file
// leaves out the middle one.
const BYTE_TILES = [
  Uint8Array.from([1, 2, 3, 250, 4, 5, 6, 250]),
  new Uint8Array(0),
  Uint8Array.from([7, 8, 9, 250, 10, 11, 12, 250]),
]

describe('computeChannelAutoContrast', () => {
  it('computes robust contrast from the smallest pyramid level', async () => {
    const loader = fakeLoader({
      numLevels: 3,
      tiles: [{ col: 0, row: 0 }],
      sourceWidth: 6,
      sourceHeight: 1,
    })
    const decodeTile = vi.fn(async (): Promise<DecodedJpeg2000> => {
      return {
        width: 6,
        height: 1,
        pixels: new Uint16Array([0, 10, 20, 30, 40, 1000]),
      }
    })

    await expect(
      computeChannelAutoContrast(loader, {
        decodeTile,
        lowPercentile: 20,
        highPercentile: 80,
      }),
    ).resolves.toMatchObject({
      min: 10,
      max: 40,
      histogram: {
        min: 10,
        max: 40,
        sampleCount: 6,
      },
    })

    expect(loader.requestedTiles).toEqual([{ level: 2, col: 0, row: 0 }])
  })

  it('crops padded edge-tile pixels before estimating contrast', async () => {
    const loader = fakeLoader({
      numLevels: 1,
      tiles: [{ col: 0, row: 0 }],
      sourceWidth: 2,
      sourceHeight: 2,
    })

    await expect(
      computeChannelAutoContrast(loader, {
        decodeTile: async () => ({
          width: 4,
          height: 4,
          pixels: new Uint16Array([
            1, 2, 900, 900, 3, 4, 900, 900, 900, 900, 900, 900, 900, 900, 900, 900,
          ]),
        }),
        lowPercentile: 0,
        highPercentile: 100,
      }),
    ).resolves.toMatchObject({
      min: 1,
      max: 4,
      histogram: {
        min: 1,
        max: 4,
        sampleCount: 4,
      },
    })
  })

  it('uses TIFF tile decode metadata when no test decoder is provided', async () => {
    const loader = fakeLoader({
      bytes: new Uint8Array([5, 10, 15, 20]),
      numLevels: 1,
      sourceHeight: 1,
      sourceWidth: 4,
      tileDecodeOptions: () => ({
        bitsPerSample: [8],
        compression: 1,
        samplesPerPixel: 1,
        tileHeight: 1,
        tileWidth: 4,
      }),
      tiles: [{ col: 0, row: 0 }],
    })

    await expect(
      computeChannelAutoContrast(loader, {
        highPercentile: 100,
        lowPercentile: 0,
      }),
    ).resolves.toMatchObject({
      histogram: {
        sampleCount: 4,
      },
      max: 20,
      min: 5,
    })
  })
})

describe('spreadTiles', () => {
  const grid = (cols: number, rows: number) =>
    Array.from({ length: rows }, (_unused, row) =>
      Array.from({ length: cols }, (_unusedCol, col) => ({ col, row })),
    ).flat()

  it('keeps every tile of a small level', () => {
    expect(spreadTiles(grid(8, 8), 64)).toHaveLength(64)
  })

  it('takes evenly spaced tiles from evenly spaced rows of a large level', () => {
    const tiles = spreadTiles(grid(20, 20), 64)

    expect(tiles).toHaveLength(64)
    expect(new Set(tiles.map((tile) => tile.row))).toEqual(
      new Set([1, 3, 6, 8, 11, 13, 16, 18]),
    )
    expect(tiles.slice(0, 8).map((tile) => tile.col)).toEqual([
      1, 3, 6, 8, 11, 13, 16, 18,
    ])
  })

  it('takes more of each row when there are few rows', () => {
    const tiles = spreadTiles(grid(156, 2), 64)

    expect(tiles).toHaveLength(64)
    expect(tiles.filter((tile) => tile.row === 0)).toHaveLength(32)
  })
})

describe('computeChannelAutoContrast off the main thread', () => {
  it('samples tile bytes in a worker as the main thread does, then ends it', async () => {
    const worker = new SamplingTileWorker()
    const options = { maxSamples: 6, lowPercentile: 0, highPercentile: 100 }

    const inWorker = await computeChannelAutoContrast(byteTileLoader(), {
      ...options,
      workerFactory: () => worker,
    })

    // jsdom has no Worker, so this run decodes on the main thread.
    expect(typeof Worker).toBe('undefined')
    await expect(computeChannelAutoContrast(byteTileLoader(), options)).resolves.toEqual(
      inWorker,
    )
    expect(inWorker).toMatchObject({ min: 1, max: 10, histogram: { sampleCount: 4 } })
    // 18 visible pixels give a stride of 3. The left-out tile is not sent and
    // adds no pixels.
    expect(worker.requests.map((request) => request.sampling)).toEqual([
      { startIndex: 0, stride: 3, width: 3, height: 2 },
      { startIndex: 6, stride: 3, width: 3, height: 2 },
    ])
    expect(worker.terminated).toBe(true)
  })

  it('ends the worker on abort', async () => {
    const worker = new SilentTileWorker()
    const controller = new AbortController()
    const contrast = computeChannelAutoContrast(byteTileLoader(), {
      signal: controller.signal,
      workerFactory: () => worker,
    })

    await vi.waitFor(() => {
      expect(worker.requests).toHaveLength(1)
    })
    controller.abort()

    await expect(contrast).rejects.toMatchObject({ name: 'AbortError' })
    expect(worker.terminated).toBe(true)
  })

  it('rejects when the worker fails', async () => {
    const worker = new SilentTileWorker()
    const contrast = computeChannelAutoContrast(byteTileLoader(), {
      workerFactory: () => worker,
    })

    await vi.waitFor(() => {
      expect(worker.requests).toHaveLength(1)
    })
    worker.onerror?.(new ErrorEvent('error', { message: 'Worker crashed' }))

    await expect(contrast).rejects.toThrow('Worker crashed')
    expect(worker.terminated).toBe(true)
  })

  it("uses the loader's own sampling, falling back to decoded pixels", async () => {
    const pixels = Uint16Array.from([5, 10, 15, 20])
    const loadTilePixels = vi.fn(async () => ({ pixels, width: 2, height: 2 }))
    const sampleTile = vi.fn(
      async (_level: number, col: number, _row: number, sampling: TileSampling) =>
        col === 0
          ? null
          : sampleDecodedTile(Uint16Array.from([100, 200]), 2, 1, sampling),
    )
    const workerFactory = vi.fn(() => new SamplingTileWorker())

    const contrast = await computeChannelAutoContrast(
      {
        numLevels: 1,
        tilesForLevel: () => [
          { col: 0, row: 0 },
          { col: 1, row: 0 },
        ],
        tileSourceSize: (_level, col) => ({
          width: imagePixels(2),
          height: imagePixels(col === 0 ? 2 : 1),
        }),
        loadTilePixels,
        sampleTilePixels: sampleTile,
      },
      { lowPercentile: 0, highPercentile: 100, workerFactory },
    )

    expect(contrast).toMatchObject({ min: 5, max: 200, histogram: { sampleCount: 6 } })
    expect(sampleTile.mock.calls.map((call) => call[3])).toEqual([
      { startIndex: 0, stride: 1, width: 2, height: 2 },
      { startIndex: 4, stride: 1, width: 2, height: 1 },
    ])
    expect(loadTilePixels).toHaveBeenCalledOnce()
    expect(workerFactory).not.toHaveBeenCalled()
  })
})

function byteTileLoader(): AutoContrastTileLoader {
  return {
    numLevels: 1,
    tilesForLevel: () => BYTE_TILES.map((_bytes, col) => ({ col, row: 0 })),
    tileSourceSize: () => ({ width: imagePixels(3), height: imagePixels(2) }),
    tileDecodeOptions: () => ({
      compression: 1,
      bitsPerSample: [8],
      samplesPerPixel: 1,
      tileWidth: 4,
      tileHeight: 2,
    }),
    fetchTileBytes: async (_level, col) => BYTE_TILES[col] ?? new Uint8Array(0),
  }
}

function fakeLoader(options: {
  readonly bytes?: Uint8Array
  readonly numLevels: number
  readonly sourceHeight: number
  readonly sourceWidth: number
  readonly tileDecodeOptions?: AutoContrastTileLoader['tileDecodeOptions']
  readonly tiles: readonly { readonly col: number; readonly row: number }[]
}): AutoContrastTileLoader & {
  readonly requestedTiles: {
    readonly level: number
    readonly col: number
    readonly row: number
  }[]
} {
  const requestedTiles: {
    readonly level: number
    readonly col: number
    readonly row: number
  }[] = []

  return {
    numLevels: options.numLevels,
    requestedTiles,
    tilesForLevel: () => options.tiles,
    ...(options.tileDecodeOptions === undefined
      ? {}
      : { tileDecodeOptions: options.tileDecodeOptions }),
    tileSourceSize: () => ({
      width: imagePixels(options.sourceWidth),
      height: imagePixels(options.sourceHeight),
    }),
    async fetchTileBytes(level, col, row) {
      requestedTiles.push({ level, col, row })
      return options.bytes ?? new Uint8Array([1, 2, 3])
    },
  }
}
