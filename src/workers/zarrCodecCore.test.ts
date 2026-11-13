import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { ownBytes, vlenUtf8Bytes } from '../test/zarrCodecFixtures'
import { decodeZarrCodec } from './zarrCodecCore'
import type { ZarrCodecChunkMeta } from './zarrDecodeMessages'

const STRING_META: ZarrCodecChunkMeta = {
  dataType: 'v2:object',
  shape: [3],
  codecs: [],
  fillValue: null,
}

function bufferOf(bytes: Uint8Array): ArrayBuffer {
  return ownBytes(bytes).buffer
}

describe('decodeZarrCodec', () => {
  it('decompresses bytes into a buffer it transfers', async () => {
    const result = await decodeZarrCodec(
      7,
      { name: 'numcodecs.gzip', configuration: { level: 1 }, meta: STRING_META },
      bufferOf(gzipSync(Uint8Array.from([4, 5, 6]))),
    )

    expect(result.response.type).toBe('codec-bytes')
    expect(result.response.id).toBe(7)
    const bytes = result.response.type === 'codec-bytes' ? result.response.bytes : null
    expect(Array.from(new Uint8Array(bytes ?? new ArrayBuffer(0)))).toEqual([4, 5, 6])
    expect(result.transfer).toEqual([bytes])
  })

  it('decodes variable-length strings into a chunk', async () => {
    const result = await decodeZarrCodec(
      2,
      { name: 'numcodecs.vlen-utf8', configuration: {}, meta: STRING_META },
      bufferOf(vlenUtf8Bytes(['spot-1', 'épithélium', ''])),
    )

    expect(result.response).toEqual({
      type: 'codec-chunk',
      id: 2,
      data: ['spot-1', 'épithélium', ''],
      shape: [3],
      stride: [1],
    })
    expect(result.transfer).toEqual([])
  })

  it('decodes JSON-encoded objects into a chunk', async () => {
    const json = new TextEncoder().encode(JSON.stringify(['a', 'b', null, '|O', [3]]))
    const result = await decodeZarrCodec(
      3,
      { name: 'numcodecs.json2', configuration: {}, meta: STRING_META },
      bufferOf(json),
    )

    expect(result.response).toMatchObject({ data: ['a', 'b', null], shape: [3] })
  })

  it('rejects a codec the registry does not have', async () => {
    await expect(
      decodeZarrCodec(
        1,
        { name: 'numcodecs.unknown', configuration: {}, meta: STRING_META },
        new ArrayBuffer(1),
      ),
    ).rejects.toThrow('numcodecs.unknown')
  })
})
