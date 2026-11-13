import * as zarr from 'zarrita'
import { sharedZarrDecodePool } from '../workers/zarrDecodePool'
import type {
  ZarrCodecCall,
  ZarrCodecChunk,
  ZarrCodecChunkMeta,
  ZarrCodecEntry,
} from '../workers/zarrDecodeMessages'

// zarrita decodes the chunks of every Zarr read made on the main thread
// (Xenium matrix and transcripts, H5AD references, SpatialData tables). Its
// decompressors and string codecs are the costly steps, so these run in the
// Zarr decode workers instead; the cheap steps (byte order, transpose,
// filters) and assembling the selection stay on the main thread.
const WORKER_CODECS = {
  blosc: 'bytes_to_bytes',
  lz4: 'bytes_to_bytes',
  zstd: 'bytes_to_bytes',
  gzip: 'bytes_to_bytes',
  zlib: 'bytes_to_bytes',
  'vlen-utf8': 'array_to_bytes',
  json2: 'array_to_bytes',
} as const satisfies Record<string, NonNullable<ZarrCodecEntry['kind']>>

export interface ZarrCodecDecoder {
  decodeCodec(
    codec: ZarrCodecCall,
    bytes: Uint8Array,
  ): Promise<Uint8Array | ZarrCodecChunk>
}

type ZarrCodecLoader = () => Promise<ZarrCodecEntry>
type ZarrCodec = ReturnType<ZarrCodecEntry['fromConfig']>

const workerLoaders = new WeakSet<ZarrCodecLoader>()

// Points zarrita's codec registry at the worker codecs. Called once on the
// main thread before any Zarr read; workers keep zarrita's own codecs. Where
// there is no `Worker` (Vitest's jsdom) nothing changes. Returns a function
// that restores the previous codecs.
export function installWorkerZarrCodecs(
  decoder: ZarrCodecDecoder | null = sharedZarrDecodePool(),
  registry: Map<string, ZarrCodecLoader> = zarr.registry,
): () => void {
  const restore: (() => void)[] = []

  if (decoder === null) {
    return () => undefined
  }

  for (const [codecName, kind] of Object.entries(WORKER_CODECS)) {
    for (const name of [codecName, `numcodecs.${codecName}`]) {
      const loadOriginal = registry.get(name)

      if (loadOriginal === undefined || workerLoaders.has(loadOriginal)) {
        continue
      }

      const entry = workerCodecEntry(name, kind, loadOriginal, decoder)
      const load: ZarrCodecLoader = () => Promise.resolve(entry)
      workerLoaders.add(load)
      registry.set(name, load)
      restore.push(() => registry.set(name, loadOriginal))
    }
  }

  return () => {
    for (const undo of restore) {
      undo()
    }
  }
}

function workerCodecEntry(
  name: string,
  kind: NonNullable<ZarrCodecEntry['kind']>,
  loadOriginal: ZarrCodecLoader,
  decoder: ZarrCodecDecoder,
): ZarrCodecEntry {
  return {
    kind,
    fromConfig(configuration: unknown, meta: ZarrCodecChunkMeta): ZarrCodec {
      let original: Promise<ZarrCodec> | undefined
      // zarrita's own loaders may return the codec without a promise.
      const onMainThread = () =>
        (original ??= Promise.resolve(loadOriginal()).then((entry) =>
          entry.fromConfig(configuration, meta),
        ))

      const codec = {
        kind,
        encode: async (data: Uint8Array) => (await onMainThread()).encode(data),
        async decode(bytes: Uint8Array): Promise<Uint8Array | ZarrCodecChunk> {
          try {
            return await decoder.decodeCodec({ name, configuration, meta }, bytes)
          } catch {
            // A worker that fails leaves the chunk to zarrita's own codec,
            // which also reports chunks that do not decode.
            return (await onMainThread()).decode(bytes)
          }
        },
      }

      // String codecs decode to a chunk, which zarrita's codec type leaves out.
      return codec as unknown as ZarrCodec
    },
  }
}
