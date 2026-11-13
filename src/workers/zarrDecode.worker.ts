/// <reference lib="webworker" />

import type * as zarr from 'zarrita'
import { labelWindow, traceLabelEdges } from '../datasets/spatialDataLabelTrace'
import { numericPixelsToRgba } from '../zarr/omeZarrPixels'
import { decodeZarrCodec } from './zarrCodecCore'
import { chunkWindow, chunkWindowSamples, decodeChunk } from './zarrDecodeCore'
import type {
  ZarrChunkSource,
  ZarrDecodeCodecMessage,
  ZarrDecodeRequest,
  ZarrDecodeResponse,
  ZarrRenderTileMessage,
  ZarrSampleTileMessage,
  ZarrTraceLabelsMessage,
} from './zarrDecodeMessages'

const workerScope = self as DedicatedWorkerGlobalScope
// Decoded chunks kept per worker; requests for one chunk go to one worker.
const CHUNK_CACHE_MAX_BYTES = 128 * 1024 * 1024

interface CachedChunk {
  readonly promise: Promise<zarr.Chunk<zarr.DataType>>
  bytes: number
}

const chunks = new Map<string, CachedChunk>()
let cachedBytes = 0

workerScope.onmessage = (event: MessageEvent<ZarrDecodeRequest>) => {
  const message = event.data

  if (message.type === 'put-chunk') {
    putChunk(message.cacheKey, message.source, message.bytes)
    return
  }

  if (message.type === 'render-tile') {
    void renderTile(message)
    return
  }

  if (message.type === 'sample-tile') {
    void sampleTile(message)
    return
  }

  if (message.type === 'decode-codec') {
    void decodeCodec(message)
    return
  }

  void traceLabels(message)
}

function putChunk(cacheKey: string, source: ZarrChunkSource, bytes: ArrayBuffer | null) {
  const existing = chunks.get(cacheKey)

  if (existing !== undefined) {
    cachedBytes -= existing.bytes
  }

  const entry: CachedChunk = { promise: decodeChunk(source, bytes), bytes: 0 }
  chunks.set(cacheKey, entry)
  entry.promise.then(
    (chunk) => {
      if (chunks.get(cacheKey) !== entry) {
        return
      }

      entry.bytes = (chunk.data as { readonly byteLength?: number }).byteLength ?? 0
      cachedBytes += entry.bytes
      evict()
    },
    () => {
      if (chunks.get(cacheKey) === entry) {
        chunks.delete(cacheKey)
      }
    },
  )
}

// Marks a cached chunk most recently used and returns it. For a chunk the
// worker does not hold, answers a miss and returns undefined.
function cachedChunk(
  cacheKey: string,
  id: number,
): Promise<zarr.Chunk<zarr.DataType>> | undefined {
  const entry = chunks.get(cacheKey)

  if (entry === undefined) {
    respond({ type: 'miss', id })
    return undefined
  }

  chunks.delete(cacheKey)
  chunks.set(cacheKey, entry)
  return entry.promise
}

async function renderTile(message: ZarrRenderTileMessage): Promise<void> {
  const cached = cachedChunk(message.cacheKey, message.id)

  if (cached === undefined) {
    return
  }

  try {
    const chunk = await cached
    const pixels = chunkWindow(chunk, message.window)
    const rgba = numericPixelsToRgba(
      pixels,
      message.window.width,
      message.window.height,
      message.render,
    )
    const bitmap = await createImageBitmap(
      new ImageData(
        new Uint8ClampedArray(rgba.rgba) as Uint8ClampedArray<ArrayBuffer>,
        message.window.width,
        message.window.height,
      ),
    )
    respond(
      {
        type: 'tile',
        id: message.id,
        bitmap,
        width: message.window.width,
        height: message.window.height,
        lo: rgba.lo,
        hi: rgba.hi,
      },
      [bitmap],
    )
  } catch (error) {
    respond({ type: 'error', id: message.id, error: errorMessage(error) })
  }
}

async function sampleTile(message: ZarrSampleTileMessage): Promise<void> {
  const cached = cachedChunk(message.cacheKey, message.id)

  if (cached === undefined) {
    return
  }

  try {
    const tile = chunkWindowSamples(await cached, message.window, message.sampling)
    respond(
      {
        type: 'samples',
        id: message.id,
        samples: tile.samples,
        pixelCount: tile.pixelCount,
      },
      [tile.samples.buffer],
    )
  } catch (error) {
    respond({ type: 'error', id: message.id, error: errorMessage(error) })
  }
}

async function traceLabels(message: ZarrTraceLabelsMessage): Promise<void> {
  try {
    const chunk = await decodeChunk(message.source, message.bytes)
    const { window } = message
    const labels = labelWindow(
      chunk.data as unknown as ArrayLike<number | bigint>,
      chunk.stride,
      window.xAxis,
      window.yAxis,
      window.width,
      window.height,
    )
    const trace = traceLabelEdges(
      labels,
      window.width,
      window.height,
      message.levelX0,
      message.levelY0,
      message.levelWidth,
    )
    respond({ type: 'labels', id: message.id, trace }, [
      trace.labels.buffer,
      trace.edgeOffsets.buffer,
      trace.edges.buffer,
      trace.bounds.buffer,
      trace.pixelCounts.buffer,
    ])
  } catch (error) {
    respond({ type: 'error', id: message.id, error: errorMessage(error) })
  }
}

async function decodeCodec(message: ZarrDecodeCodecMessage): Promise<void> {
  try {
    const result = await decodeZarrCodec(message.id, message.codec, message.bytes)
    respond(result.response, result.transfer)
  } catch (error) {
    respond({ type: 'error', id: message.id, error: errorMessage(error) })
  }
}

function evict(): void {
  for (const [key, entry] of chunks) {
    if (cachedBytes <= CHUNK_CACHE_MAX_BYTES || chunks.size <= 1) {
      return
    }

    if (entry.bytes === 0) {
      continue
    }

    chunks.delete(key)
    cachedBytes -= entry.bytes
  }
}

function respond(response: ZarrDecodeResponse, transfer: Transferable[] = []): void {
  workerScope.postMessage(response, transfer)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
