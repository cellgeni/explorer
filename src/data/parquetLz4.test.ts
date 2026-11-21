import { compressors } from 'hyparquet-compressors'
import { describe, expect, it } from 'vitest'

// patches/hyparquet-compressors+1.1.1.patch: the LZ4 decoder added the
// minimum match of 4 before testing the match-length nibble for 15, so a
// nibble of 11 read an extension byte and a nibble of 15 did not.
describe('LZ4 pages of Parquet files', () => {
  const encoder = new TextEncoder()
  const pattern = (length: number) =>
    encoder.encode('abcdefgh'.repeat(Math.ceil(length / 8)).slice(0, length))

  // One block: 8 literals, a match at offset 8 whose length is coded in
  // `matchCode` (nibble, then extension bytes), and 5 closing literals.
  function block(matchNibble: number, extension: readonly number[], length: number) {
    const output = pattern(length)
    return Uint8Array.from([
      (8 << 4) | matchNibble,
      ...output.subarray(0, 8),
      8,
      0,
      ...extension,
      5 << 4,
      ...output.subarray(length - 5),
    ])
  }

  it.each([
    // 15: 8 + 15 + 5.
    ['a match-length nibble of 11', block(11, [], 28), 28],
    // 4 + 15 + 6 × 255 + 38 = 1,587: 8 + 1,587 + 5.
    [
      'a match length with extension bytes',
      block(15, [255, 255, 255, 255, 255, 255, 38], 1_600),
      1_600,
    ],
  ])('decodes %s', (_name, input, length) => {
    const decode = compressors.LZ4_RAW

    expect(decode).toBeDefined()
    expect(Array.from(decode?.(input, length) ?? [])).toEqual(Array.from(pattern(length)))
  })
})
