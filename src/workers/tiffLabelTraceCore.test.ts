import { describe, expect, it } from 'vitest'
import { tiffLabelWindow, traceTiffLabelTile } from './tiffLabelTraceCore'

const window = { width: 2, height: 2, levelX0: 0, levelY0: 0, levelWidth: 2 }

describe('tiffLabelWindow', () => {
  it('reads unsigned 16-bit and 32-bit labels inside a padded tile', () => {
    const uint16 = new Uint16Array([1, 2, 99, 3, 4, 99]).buffer
    expect(
      Array.from(
        tiffLabelWindow(uint16, { ...window, bitsPerSample: [16], tileWidth: 3 }),
      ),
    ).toEqual([1, 2, 3, 4])

    const uint32 = new Uint32Array([70_000, 0, 0, 1]).buffer
    expect(
      Array.from(
        tiffLabelWindow(uint32, { ...window, bitsPerSample: [32], tileWidth: 2 }),
      ),
    ).toEqual([70_000, 0, 0, 1])
  })

  it('reads big-endian, signed and float labels', () => {
    const view = new DataView(new ArrayBuffer(16))
    ;[5, 0, 70_001, 2].forEach((value, index) => {
      view.setUint32(index * 4, value, false)
    })
    expect(
      Array.from(
        tiffLabelWindow(view.buffer, {
          ...window,
          bitsPerSample: [32],
          tileWidth: 2,
          littleEndian: false,
        }),
      ),
    ).toEqual([5, 0, 70_001, 2])

    const floats = new Float32Array([1, 2.0000001, 0, 3]).buffer
    expect(
      Array.from(
        tiffLabelWindow(floats, {
          ...window,
          bitsPerSample: [32],
          sampleFormat: 3,
          tileWidth: 2,
        }),
      ),
    ).toEqual([1, 2, 0, 3])
  })

  it('refuses multi-sample, 64-bit and short tiles', () => {
    expect(() =>
      tiffLabelWindow(new ArrayBuffer(24), { ...window, bitsPerSample: [8, 8, 8] }),
    ).toThrow('one sample per pixel')
    expect(() =>
      tiffLabelWindow(new ArrayBuffer(32), { ...window, bitsPerSample: [64] }),
    ).toThrow('64-bit')
    expect(() =>
      tiffLabelWindow(new ArrayBuffer(4), {
        ...window,
        bitsPerSample: [16],
        tileWidth: 2,
      }),
    ).toThrow('shorter')
  })
})

describe('traceTiffLabelTile', () => {
  it('traces an uncompressed tile, and treats a missing tile as background', async () => {
    const bytes = new Uint8Array(new Uint32Array([7, 7, 0, 7]).buffer)
    const trace = await traceTiffLabelTile(bytes, {
      ...window,
      bitsPerSample: [32],
      compression: 1,
      tileWidth: 2,
      tileHeight: 2,
    })

    expect(Array.from(trace.labels)).toEqual([7])
    expect(Array.from(trace.pixelCounts)).toEqual([3])

    const empty = await traceTiffLabelTile(new Uint8Array(0), {
      ...window,
      bitsPerSample: [32],
      tileWidth: 2,
      tileHeight: 2,
    })
    expect(empty.labels.length).toBe(0)
  })
})
