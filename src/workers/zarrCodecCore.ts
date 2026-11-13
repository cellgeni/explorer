import * as zarr from 'zarrita'
import type {
  ZarrCodecCall,
  ZarrCodecChunk,
  ZarrCodecEntry,
  ZarrDecodeResponse,
} from './zarrDecodeMessages'

export interface ZarrCodecResult {
  readonly response: ZarrDecodeResponse
  readonly transfer: Transferable[]
}

// Runs one codec step for a chunk zarrita decodes on the main thread (see
// src/zarr/workerZarrCodecs.ts), with zarrita's own codec. Workers never
// install the worker codecs, so their registry still holds zarrita's.
export async function decodeZarrCodec(
  id: number,
  call: ZarrCodecCall,
  bytes: ArrayBuffer,
  registry: ReadonlyMap<string, () => Promise<ZarrCodecEntry>> = zarr.registry,
): Promise<ZarrCodecResult> {
  const load = registry.get(call.name)

  if (load === undefined) {
    throw new zarr.UnknownCodecError(call.name)
  }

  const codec = (await load()).fromConfig(call.configuration, call.meta)
  // String codecs decode to a chunk, which zarrita's codec type leaves out.
  const decoded: unknown = await codec.decode(new Uint8Array(bytes))

  if (decoded instanceof Uint8Array) {
    const buffer = ownedBuffer(decoded)
    return { response: { type: 'codec-bytes', id, bytes: buffer }, transfer: [buffer] }
  }

  if (isCodecChunk(decoded)) {
    return {
      response: {
        type: 'codec-chunk',
        id,
        data: decoded.data,
        shape: decoded.shape,
        stride: decoded.stride,
      },
      transfer: [],
    }
  }

  throw new Error(`Zarr codec ${call.name} decoded to an unsupported value.`)
}

// The decoded bytes as a buffer of their own, so it can be transferred.
function ownedBuffer(bytes: Uint8Array): ArrayBuffer {
  if (
    bytes.buffer instanceof ArrayBuffer &&
    bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength
  ) {
    return bytes.buffer
  }

  return bytes.slice().buffer
}

function isCodecChunk(value: unknown): value is ZarrCodecChunk {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const chunk = value as Partial<Record<keyof ZarrCodecChunk, unknown>>
  return (
    Array.isArray(chunk.data) && isNumberList(chunk.shape) && isNumberList(chunk.stride)
  )
}

function isNumberList(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'number')
}
