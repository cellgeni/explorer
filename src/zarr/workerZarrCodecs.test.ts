import { deflateSync, gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as zarr from 'zarrita'
import { ownBytes, vlenUtf8Bytes } from '../test/zarrCodecFixtures'
import { decodeZarrCodec } from '../workers/zarrCodecCore'
import type { ZarrCodecCall } from '../workers/zarrDecodeMessages'
import { installWorkerZarrCodecs, type ZarrCodecDecoder } from './workerZarrCodecs'

// zarrita's own codecs, as a worker's registry holds them.
const ZARRITA_CODECS = new Map(zarr.registry)

// Runs codec steps as the Zarr decode worker does, behind structured clones.
function workerDecoder(): ZarrCodecDecoder & { readonly calls: string[] } {
  const calls: string[] = []

  return {
    calls,
    async decodeCodec(codec: ZarrCodecCall, bytes: Uint8Array) {
      calls.push(codec.name)
      const { response } = await decodeZarrCodec(
        1,
        structuredClone(codec),
        structuredClone(ownBytes(bytes).buffer),
        ZARRITA_CODECS,
      )
      const received = structuredClone(response)

      if (received.type === 'codec-bytes') {
        return new Uint8Array(received.bytes)
      }

      if (received.type === 'codec-chunk') {
        return { data: received.data, shape: received.shape, stride: received.stride }
      }

      throw new Error('Unexpected codec response.')
    },
  }
}

const encoder = new TextEncoder()

// A Zarr v2 store with a gzipped string array (two chunks) and a
// zlib-compressed uint16 array.
function store(): Map<string, Uint8Array> {
  const json = (value: unknown) => encoder.encode(JSON.stringify(value))

  return new Map([
    ['/.zgroup', json({ zarr_format: 2 })],
    [
      '/names/.zarray',
      json({
        zarr_format: 2,
        shape: [3],
        chunks: [2],
        dtype: '|O',
        compressor: { id: 'gzip', level: 1 },
        filters: [{ id: 'vlen-utf8' }],
        fill_value: null,
        order: 'C',
      }),
    ],
    ['/names/0', ownBytes(gzipSync(vlenUtf8Bytes(['spot-1', 'spot-2'])))],
    ['/names/1', ownBytes(gzipSync(vlenUtf8Bytes(['spot-3', ''])))],
    [
      '/counts/.zarray',
      json({
        zarr_format: 2,
        shape: [4],
        chunks: [4],
        dtype: '<u2',
        compressor: { id: 'zlib', level: 1 },
        filters: null,
        fill_value: 0,
        order: 'C',
      }),
    ],
    [
      '/counts/0',
      ownBytes(deflateSync(new Uint8Array(Uint16Array.from([3, 0, 512, 7]).buffer))),
    ],
  ])
}

async function readStore(): Promise<{ names: unknown; counts: unknown }> {
  const root = zarr.root(store())
  const names = await zarr.open.v2(root.resolve('names'), { kind: 'array' })
  const counts = await zarr.open.v2(root.resolve('counts'), { kind: 'array' })

  return {
    names: (await zarr.get(names, [null])).data,
    counts: Array.from((await zarr.get(counts, [null])).data as Uint16Array),
  }
}

const EXPECTED = {
  names: ['spot-1', 'spot-2', 'spot-3'],
  counts: [3, 0, 512, 7],
}

let uninstall: () => void = () => undefined

afterEach(() => {
  uninstall()
  uninstall = () => undefined
})

describe('installWorkerZarrCodecs', () => {
  it('decompresses and decodes strings in the worker, with the same values', async () => {
    const decoder = workerDecoder()
    uninstall = installWorkerZarrCodecs(decoder)

    expect(await readStore()).toEqual(EXPECTED)
    expect([...new Set(decoder.calls)].sort()).toEqual([
      'numcodecs.gzip',
      'numcodecs.vlen-utf8',
      'numcodecs.zlib',
    ])
    // Two string chunks, each decompressed then decoded; one numeric chunk.
    expect(decoder.calls).toHaveLength(5)
  })

  it('decodes on the main thread when the worker fails', async () => {
    const decodeCodec = vi.fn(() => Promise.reject(new Error('worker failed')))
    uninstall = installWorkerZarrCodecs({ decodeCodec })

    expect(await readStore()).toEqual(EXPECTED)
    expect(decodeCodec).toHaveBeenCalled()
  })

  it('reports a chunk that does not decode', async () => {
    uninstall = installWorkerZarrCodecs(workerDecoder())
    const corrupt = store()
    corrupt.set('/counts/0', Uint8Array.from([1, 2, 3]))
    const counts = await zarr.open.v2(zarr.root(corrupt).resolve('counts'), {
      kind: 'array',
    })

    await expect(zarr.get(counts, [null])).rejects.toThrow()
  })

  it('wraps each codec once and restores zarrita codecs', async () => {
    const original = zarr.registry.get('numcodecs.blosc')
    const first = installWorkerZarrCodecs(workerDecoder())
    const installed = zarr.registry.get('numcodecs.blosc')
    const second = installWorkerZarrCodecs(workerDecoder())

    expect(installed).not.toBe(original)
    expect(zarr.registry.get('numcodecs.blosc')).toBe(installed)

    second()
    first()
    expect(zarr.registry.get('numcodecs.blosc')).toBe(original)
    expect(zarr.registry.get('bytes')).toBe(ZARRITA_CODECS.get('bytes'))
  })

  it('leaves zarrita codecs alone without workers', () => {
    uninstall = installWorkerZarrCodecs(null)

    expect(new Map(zarr.registry)).toEqual(ZARRITA_CODECS)
  })
})
