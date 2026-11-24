import { describe, expect, it } from 'vitest'
import {
  crc32,
  insertPngChunks,
  pngPhysChunk,
  pngTextChunk,
  pngTextEntries,
  readPngChunks,
} from './pngChunks'

// A 1×1 PNG: signature, IHDR, IDAT and IEND.
const ONE_PIXEL_PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  ),
  (char) => char.charCodeAt(0),
)

describe('PNG chunks (plan 27-D11)', () => {
  it('computes PNG’s CRC-32', () => {
    expect(crc32(new TextEncoder().encode('IEND'))).toBe(0xae426082)
  })

  it('inserts chunks after IHDR, each with a good CRC', () => {
    const png = insertPngChunks(ONE_PIXEL_PNG, [
      pngPhysChunk(300),
      pngTextChunk('Software', 'Spatial Omics Explorer'),
    ])
    const chunks = readPngChunks(png)

    expect(chunks.map((chunk) => chunk.type)).toEqual([
      'IHDR',
      'pHYs',
      'tEXt',
      'IDAT',
      'IEND',
    ])
    expect(png.length).toBe(ONE_PIXEL_PNG.length + 21 + 12 + 'Software'.length + 1 + 22)
  })

  it('writes dpi as pixels per metre', () => {
    const data = pngPhysChunk(300).data
    const view = new DataView(data.buffer)

    expect(view.getUint32(0)).toBe(11811)
    expect(view.getUint32(4)).toBe(11811)
    expect(data[8]).toBe(1)
  })

  it('reads text back, in tEXt for Latin-1 and iTXt otherwise', () => {
    const png = insertPngChunks(ONE_PIXEL_PNG, [
      pngTextChunk('Description', 'x 0 to 10 µm; 0.5 µm per pixel'),
      pngTextChunk('Source', 'https://example.test/腦.h5ad'),
    ])

    expect(readPngChunks(png).map((chunk) => chunk.type)).toContain('iTXt')
    expect(pngTextEntries(png)).toEqual({
      Description: 'x 0 to 10 µm; 0.5 µm per pixel',
      Source: 'https://example.test/腦.h5ad',
    })
  })

  it('refuses a file that is not a PNG', () => {
    expect(() => insertPngChunks(new Uint8Array(16), [])).toThrow(/Not a PNG/)
  })

  it('finds a damaged chunk', () => {
    const png = insertPngChunks(ONE_PIXEL_PNG, [pngTextChunk('Software', 'x')])
    // The first byte of the text chunk's data, after the signature and IHDR.
    const first = 8 + 25 + 8
    png[first] = (png[first] ?? 0) ^ 1

    expect(() => readPngChunks(png)).toThrow(/CRC/)
  })
})
