import { describe, expect, it } from 'vitest'
import { micrometers } from '../data/coords'
import {
  encodeImageArrayAsBmp,
  micrometersPerPixelFromLattice,
  parseVisiumClustersCsv,
  parseVisiumScalefactors,
  parseVisiumTissuePositions,
  resolveVisiumUnits,
  visiumSpotRing,
  type VisiumLatticeSample,
} from './visiumFormat'

// Visium lattice: even rows use even columns, odd rows odd columns; one
// column index is 50 µm and one row 86.6 µm. Pixels are `pixelsPerMicrometer`
// apart, rotated by `angle` radians.
function visiumLattice(options: {
  readonly micrometersPerPixel: number
  readonly angle?: number
  readonly rows?: number
  readonly cols?: number
}): VisiumLatticeSample[] {
  const { micrometersPerPixel, angle = 0, rows = 8, cols = 16 } = options
  const samples: VisiumLatticeSample[] = []

  for (let row = 0; row < rows; row += 1) {
    for (let col = row % 2; col < cols; col += 2) {
      const xMicrometers = col * 50
      const yMicrometers = (row * 100 * Math.sqrt(3)) / 2
      const x =
        (Math.cos(angle) * xMicrometers - Math.sin(angle) * yMicrometers) /
        micrometersPerPixel
      const y =
        (Math.sin(angle) * xMicrometers + Math.cos(angle) * yMicrometers) /
        micrometersPerPixel
      samples.push({ row, col, x: 1000 + x, y: 2000 + y })
    }
  }

  return samples
}

describe('parseVisiumScalefactors', () => {
  it('reads the Space Ranger fields and drops unknown or invalid values', () => {
    expect(
      parseVisiumScalefactors({
        tissue_hires_scalef: 0.17011142,
        tissue_lowres_scalef: '0.051033426',
        fiducial_diameter_fullres: 144.4773339857,
        spot_diameter_fullres: 89.43834961021503,
        regist_target_img_scalef: 0.2,
        microns_per_pixel: 0,
      }),
    ).toEqual({
      tissueHiresScalef: 0.17011142,
      tissueLowresScalef: 0.051033426,
      fiducialDiameterFullres: 144.4773339857,
      spotDiameterFullres: 89.43834961021503,
    })
  })
})

describe('parseVisiumTissuePositions', () => {
  it('reads Space Ranger 2.0+ tissue_positions.csv with a header', () => {
    const positions = parseVisiumTissuePositions(
      [
        'barcode,in_tissue,array_row,array_col,pxl_row_in_fullres,pxl_col_in_fullres',
        'GTCACTTCCTTCTAGA-1,0,0,0,1832,11971',
        'CACGGTCTCCTTACGA-1,1,0,2,1832.5,11833',
        '',
      ].join('\r\n'),
    )

    expect(positions.barcodes).toEqual(['GTCACTTCCTTCTAGA-1', 'CACGGTCTCCTTACGA-1'])
    expect(Array.from(positions.inTissue)).toEqual([0, 1])
    expect(Array.from(positions.arrayCols)).toEqual([0, 2])
    expect(Array.from(positions.pixelX)).toEqual([11971, 11833])
    expect(Array.from(positions.pixelY)).toEqual([1832, 1832.5])
  })

  it('reads Space Ranger 1.x tissue_positions_list.csv without a header', () => {
    const positions = parseVisiumTissuePositions(
      'AAACAACGAATAGTTC-1,0,0,16,2464,7880\nAAACAAGTATCTCCCA-1,1,50,102,8468,2807\n',
    )

    expect(positions.barcodes).toHaveLength(2)
    expect(Array.from(positions.arrayRows)).toEqual([0, 50])
    expect(Array.from(positions.pixelX)).toEqual([7880, 2807])
    expect(Array.from(positions.pixelY)).toEqual([2464, 8468])
  })

  it('finds columns by name in reordered or quoted headers', () => {
    const positions = parseVisiumTissuePositions(
      [
        '"pxl_col_in_fullres","pxl_row_in_fullres","barcode","in_tissue","array_row","array_col"',
        '10,20,"A-1",1,3,5',
      ].join('\n'),
    )

    expect(positions.barcodes).toEqual(['A-1'])
    expect(Array.from(positions.pixelX)).toEqual([10])
    expect(Array.from(positions.arrayCols)).toEqual([5])
  })

  it('names the missing columns', () => {
    expect(() => parseVisiumTissuePositions('barcode,in_tissue\nA-1,1\n')).toThrow(
      /missing the array_row, array_col, pxl_row_in_fullres, pxl_col_in_fullres columns/,
    )
  })
})

describe('Visium units', () => {
  it('fits micrometres per pixel from the spot lattice, including rotated images', () => {
    expect(
      micrometersPerPixelFromLattice(visiumLattice({ micrometersPerPixel: 0.7 })),
    ).toBeCloseTo(0.7, 6)
    expect(
      micrometersPerPixelFromLattice(
        visiumLattice({ micrometersPerPixel: 2.5, angle: Math.PI / 2 }),
      ),
    ).toBeCloseTo(2.5, 6)
  })

  it('rejects array indices that are not the Visium lattice', () => {
    const square = visiumLattice({ micrometersPerPixel: 1 }).map((sample) => ({
      ...sample,
      y: sample.row * 50,
    }))

    expect(micrometersPerPixelFromLattice(square)).toBeNull()
    expect(
      micrometersPerPixelFromLattice(
        visiumLattice({ micrometersPerPixel: 1 }).slice(0, 5),
      ),
    ).toBeNull()
  })

  it('prefers a declared scale, then the lattice, the spot pitch, and the spot diameter', () => {
    const lattice = visiumLattice({ micrometersPerPixel: 0.5 })
    const centers = lattice.map(({ x, y }) => ({ x, y }))

    expect(
      resolveVisiumUnits({
        scalefactors: { micronsPerPixel: 0.25, spotDiameterFullres: 100 },
        lattice,
        centers,
      }),
    ).toMatchObject({ micrometersPerPixel: 0.25, source: 'scalefactors' })
    expect(
      resolveVisiumUnits({
        scalefactors: { spotDiameterFullres: 100 },
        lattice,
        centers,
      }),
    ).toMatchObject({ source: 'spot-grid' })
    expect(
      resolveVisiumUnits({ scalefactors: { spotDiameterFullres: 100 }, centers })
        .micrometersPerPixel,
    ).toBeCloseTo(0.5, 6)
    expect(
      resolveVisiumUnits({ scalefactors: { spotDiameterFullres: 100 }, centers }).source,
    ).toBe('spot-pitch')
    expect(resolveVisiumUnits({ scalefactors: { spotDiameterFullres: 100 } })).toEqual({
      micrometersPerPixel: 0.65,
      source: 'spot-diameter',
      detail: 'spot_diameter_fullres as 65 µm',
    })
    expect(resolveVisiumUnits({ scalefactors: {} })).toMatchObject({
      micrometersPerPixel: 1,
      source: 'unknown',
    })
  })
})

describe('visiumSpotRing', () => {
  it('draws a 55 µm spot as a 32-sided ring around the centre', () => {
    const ring = visiumSpotRing({ x: micrometers(100), y: micrometers(200) })

    expect(ring).toHaveLength(32)
    expect(ring[0]?.x).toBeCloseTo(127.5)
    expect(ring[0]?.y).toBeCloseTo(200)
    expect(ring[8]?.y).toBeCloseTo(227.5)
  })
})

describe('parseVisiumClustersCsv', () => {
  it('maps barcodes to cluster labels', () => {
    const clusters = parseVisiumClustersCsv('Barcode,Cluster\nA-1,3\nB-1,1\n\n')

    expect(Object.fromEntries(clusters)).toEqual({ 'A-1': '3', 'B-1': '1' })
  })
})

describe('encodeImageArrayAsBmp', () => {
  it('writes a top-down 24-bit BMP with padded rows', () => {
    // 2 x 1 RGB pixels: red, green.
    const bytes = encodeImageArrayAsBmp(new Uint8Array([255, 0, 0, 0, 255, 0]), [1, 2, 3])
    const view = new DataView(bytes.buffer)

    expect(String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0)).toBe('BM')
    expect(view.getUint32(2, true)).toBe(bytes.length)
    expect(view.getInt32(18, true)).toBe(2)
    expect(view.getInt32(22, true)).toBe(-1)
    expect(view.getUint16(28, true)).toBe(24)
    // One 6-byte row padded to 8 bytes after the 54-byte header.
    expect(bytes.length).toBe(54 + 8)
    expect(Array.from(bytes.slice(54, 60))).toEqual([0, 0, 255, 0, 255, 0])
  })

  it('scales 0-1 floats and repeats grayscale into RGB, dropping alpha', () => {
    const floats = encodeImageArrayAsBmp(
      new Float32Array([1, 0.5, 0, 0.25, 0, 0, 0.25, 1]),
      [1, 2, 4],
    )
    expect(Array.from(floats.slice(54, 60))).toEqual([0, 128, 255, 64, 0, 0])

    const gray = encodeImageArrayAsBmp(new Uint8Array([7]), [1, 1])
    expect(Array.from(gray.slice(54, 57))).toEqual([7, 7, 7])
  })

  it('rejects shapes that are not images', () => {
    expect(() => encodeImageArrayAsBmp(new Uint8Array(4), [4])).toThrow(/shape/)
    expect(() => encodeImageArrayAsBmp(new Uint8Array(4), [1, 2, 2])).toThrow(/shape/)
  })
})
