import { describe, expect, it } from 'vitest'
import { readRleBitPackedHybrid } from 'hyparquet/src/encoding.js'

// Guards patches/hyparquet+*.patch. Polars writes the last bit-packed group
// of dictionary indices with only the bytes its real values need, rather than
// padding it to 8 values; unpatched hyparquet reads past the page end.
describe('hyparquet bit-packed runs', () => {
  it('decodes a final group truncated to the bytes its values need', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 0, 5]
    const width = 3
    const groups = Math.ceil(values.length / 8)
    const run = new Uint8Array([(groups << 1) | 1, ...packBits(values, width)])
    const reader = { view: new DataView(run.buffer), offset: 0 }
    const output = new Array<number>(values.length)

    expect(run.byteLength).toBe(1 + Math.ceil((values.length * width) / 8))

    readRleBitPackedHybrid(reader, width, output, run.byteLength)

    expect(output).toEqual(values)
    expect(reader.offset).toBe(run.byteLength)
  })

  it('still decodes a final group padded to 8 values', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 0, 5]
    const width = 3
    const padded = [...values, ...new Array<number>(7).fill(0)]
    const run = new Uint8Array([(2 << 1) | 1, ...packBits(padded, width)])
    const reader = { view: new DataView(run.buffer), offset: 0 }
    const output = new Array<number>(values.length)

    readRleBitPackedHybrid(reader, width, output, run.byteLength)

    expect(output).toEqual(values)
    expect(reader.offset).toBe(run.byteLength)
  })
})

function packBits(values: readonly number[], width: number): Uint8Array {
  const bytes = new Uint8Array(Math.ceil((values.length * width) / 8))

  values.forEach((value, index) => {
    for (let bit = 0; bit < width; bit++) {
      if ((value >> bit) & 1) {
        const position = index * width + bit
        bytes[position >> 3]! |= 1 << (position & 7)
      }
    }
  })

  return bytes
}
