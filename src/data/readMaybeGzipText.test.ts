import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readMaybeGzipText } from './readMaybeGzipText'

const CSV = 'barcode,in_tissue,array_row,array_col\nAAAC-1,1,0,0\nAAAG-1,0,0,2\n'

function bytesResponse(bytes: Uint8Array): Response {
  return new Response(new Uint8Array(bytes))
}

describe('readMaybeGzipText', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('decodes plain text as UTF-8', async () => {
    await expect(readMaybeGzipText(new Response(CSV))).resolves.toBe(CSV)
    await expect(readMaybeGzipText(new Response('area,µm²\n'))).resolves.toBe(
      'area,µm²\n',
    )
  })

  it('decompresses gzipped text', async () => {
    const gzipped = gzipSync(new TextEncoder().encode(CSV))

    expect([gzipped[0], gzipped[1]]).toEqual([0x1f, 0x8b])
    await expect(readMaybeGzipText(bytesResponse(gzipped))).resolves.toBe(CSV)
  })

  it('decompresses a gzipped file larger than one stream chunk', async () => {
    const rows = Array.from(
      { length: 20_000 },
      (_, index) => `cell_${index},${index % 7}`,
    )
    const text = `${rows.join('\n')}\n`

    const result = await readMaybeGzipText(
      bytesResponse(gzipSync(new TextEncoder().encode(text))),
    )

    expect(result.length).toBe(text.length)
    expect(result).toBe(text)
  })

  it('returns an empty string for an empty body', async () => {
    await expect(readMaybeGzipText(new Response(''))).resolves.toBe('')
    await expect(readMaybeGzipText(new Response(null))).resolves.toBe('')
  })

  it('needs both gzip magic bytes before decompressing', async () => {
    const onlyFirstByte = new Uint8Array([0x1f, ...new TextEncoder().encode('abc')])

    await expect(readMaybeGzipText(bytesResponse(onlyFirstByte))).resolves.toBe(
      '\u001fabc',
    )
  })

  it('rejects a body with a gzip header but corrupt data', async () => {
    const corrupt = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0xde, 0xad, 0xbe, 0xef])

    await expect(readMaybeGzipText(bytesResponse(corrupt))).rejects.toThrow()
  })

  it('explains when the browser cannot decompress gzip', async () => {
    vi.stubGlobal('DecompressionStream', undefined)
    const gzipped = gzipSync(new TextEncoder().encode(CSV))

    await expect(readMaybeGzipText(bytesResponse(gzipped))).rejects.toThrow(
      'This browser does not support gzip decompression.',
    )
    // Plain text needs no decompression, so it still reads.
    await expect(readMaybeGzipText(new Response(CSV))).resolves.toBe(CSV)
  })
})
