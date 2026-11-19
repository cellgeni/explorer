import { describe, expect, it } from 'vitest'
import { formatCellImageReadSize, imageLevelOptions } from './cellQueryImage'

describe('Cell Query image columns', () => {
  // A TIFF's tile index gives the read exactly; OME-Zarr chunks decoded
  // bound it from above, as stored chunks are compressed.
  it('says when a read size is at most', () => {
    expect(formatCellImageReadSize({ bytes: 172 * 1024 ** 2, exact: true })).toBe(
      '172 MiB',
    )
    expect(formatCellImageReadSize({ bytes: 2 * 1024 ** 3, exact: false })).toBe(
      'up to 2.0 GiB',
    )
    expect(formatCellImageReadSize({ bytes: 1024, exact: false })).toBe('under 0.1 MiB')
  })

  it('labels each level with its pixel size and read', () => {
    const channel = {
      id: 'Channel:0',
      name: 'DAPI',
      levels: [0.2125, 0.425, 0.85],
      defaultLevel: 2,
      threshold: 2188,
    }

    expect(
      imageLevelOptions(channel, [
        { bytes: 1.6 * 1024 ** 3, exact: false },
        null,
        { bytes: 172 * 1024 ** 2, exact: false },
      ]).map((option) => option.label),
    ).toEqual([
      '0.21 µm/px, up to 1.6 GiB',
      '0.42 µm/px',
      '0.85 µm/px, up to 172 MiB (default)',
    ])
  })
})
