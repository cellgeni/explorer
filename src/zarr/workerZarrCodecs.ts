import * as zarr from 'zarrita'
import { ZarrDecodeWorkerError, sharedZarrDecodePool } from '../workers/zarrDecodePool'
import { reportZarrCodecWorkerFailure } from './zarrCodecWorkerStatus'
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

// Whether the workers have failed, shared by the codecs of one installation.
interface WorkerState {
  failed: boolean
  readonly onFailure: (error: ZarrDecodeWorkerError) => void
}

// Points zarrita's codec registry at the worker codecs. Called once on the
// main thread before any Zarr read; workers keep zarrita's own codecs. Where
// there is no `Worker` (Vitest's jsdom) nothing changes. Returns a function
// that restores the previous codecs.
//
// Once a worker fails, rather than a chunk, every codec decodes on the main
// thread until the page is reloaded, and onWorkerFailure is called once. A
// worker whose script does not load fails each time it is started, so
// starting new ones would only repeat the failure.
export function installWorkerZarrCodecs(
  decoder: ZarrCodecDecoder | null = sharedZarrDecodePool(),
  registry: Map<string, ZarrCodecLoader> = zarr.registry,
  onWorkerFailure: (error: ZarrDecodeWorkerError) => void = reportZarrCodecWorkerFailure,
): () => void {
  const restore: (() => void)[] = []

  if (decoder === null) {
    return () => undefined
  }

  const workers: WorkerState = { failed: false, onFailure: onWorkerFailure }

  for (const [codecName, kind] of Object.entries(WORKER_CODECS)) {
    for (const name of [codecName, `numcodecs.${codecName}`]) {
      const loadOriginal = registry.get(name)

      if (loadOriginal === undefined || workerLoaders.has(loadOriginal)) {
        continue
      }

      const entry = workerCodecEntry(name, kind, loadOriginal, decoder, workers)
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
  workers: WorkerState,
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
          if (!workers.failed) {
            try {
              return await decoder.decodeCodec({ name, configuration, meta }, bytes)
            } catch (error) {
              if (error instanceof ZarrDecodeWorkerError && !workers.failed) {
                workers.failed = true
                workers.onFailure(error)
              }
            }
          }

          // A chunk the worker could not decode, and every chunk once the
          // workers have failed, goes to zarrita's own codec, which reports
          // chunks that do not decode.
          return (await onMainThread()).decode(bytes)
        },
      }

      // String codecs decode to a chunk, which zarrita's codec type leaves out.
      return codec as unknown as ZarrCodec
    },
  }
}
