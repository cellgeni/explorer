// IMG review: TIFF format cases with tifffile-written fixtures
// (fixtures/imaging/make_format_fixtures.py), through the real TIFF loader.
//
//   npx vitest run --config docs/review/2026-11-19/evidence/repro/vitest.repro.config.ts \
//     docs/review/2026-11-19/evidence/repro/imaging/tiffFormats.repro.ts
import { appendFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decodeTiffTilePixels } from '../../../../../../src/codecs/tiffTile'
import {
  clearOpenTiffFiles,
  openTiff,
  type TiffPyramidLoader,
} from '../../../../../../src/tiff/loader'

const FIXTURES = join(__dirname, '../../fixtures/imaging')
const LOG = join(__dirname, '../../imaging/tiffFormats.out.txt')
rmSync(LOG, { force: true })
const log = (line: string) => appendFileSync(LOG, `${line}\n`)
const pixels = JSON.parse(readFileSync(join(FIXTURES, 'pixels.json'), 'utf8')) as {
  subifd_tiles: { level1: number[][] }
  planar_rgb: { r: number[][]; g: number[][]; b: number[][] }
  zstd: { pixels: number[][] }
  int16: { pixels: number[][] }
  no_compression_tag: { pixels: number[][] }
}

async function open(name: string): Promise<TiffPyramidLoader> {
  clearOpenTiffFiles()
  const bytes = new Uint8Array(readFileSync(join(FIXTURES, name)))
  return openTiff(`https://example.test/${name}`, undefined, undefined, { bytes })
}

// Level pixels as the loader serves them: every tile decoded and cropped to
// its visible size, sample `sample` of `samples`.
async function levelPixels(
  loader: TiffPyramidLoader,
  level: number,
  sample = 0,
  samples = 1,
): Promise<number[][]> {
  const size = loader.levelSize(level)
  const out = Array.from({ length: size.height }, () =>
    new Array<number>(size.width).fill(-1),
  )
  for (const tile of loader.tilesForLevel(level)) {
    const bytes = await loader.fetchTileBytes(level, tile.col, tile.row)
    const decoded = await decodeTiffTilePixels(
      bytes,
      loader.tileDecodeOptions(level, tile.col, tile.row),
    )
    const visible = loader.tileSourceSize(level, tile.col, tile.row)
    for (let y = 0; y < visible.height; y += 1) {
      for (let x = 0; x < visible.width; x += 1) {
        const ly = tile.row * loader.tileHeight + y
        const lx = tile.col * loader.tileWidth + x
        const row = out[ly]
        if (row === undefined || lx >= size.width) continue
        row[lx] = decoded.pixels[(y * decoded.width + x) * samples + sample] ?? -2
      }
    }
  }
  return out
}

function diffCount(got: number[][], want: number[][]): number {
  let diff = 0
  want.forEach((row, y) =>
    row.forEach((value, x) => {
      if (got[y]?.[x] !== value) diff += 1
    }),
  )
  return diff
}

describe('IMG TIFF formats', () => {
  it('SubIFD level whose tile size differs from level 0', async () => {
    let outcome: string
    try {
      const loader = await open('subifd_tiles.ome.tif')
      log(
        `subifd: opened, numLevels=${loader.numLevels} tile=${loader.tileWidth}x${loader.tileHeight} level1=${JSON.stringify(loader.levelSize(1))} level1Tiles=${loader.tilesForLevel(1).length}`,
      )
      try {
        const got = await levelPixels(loader, 1)
        const diff = diffCount(got, pixels.subifd_tiles.level1)
        outcome = `level 1 decoded; ${diff} of ${48 * 32} pixels differ from the file`
      } catch (error) {
        outcome = `level 1 read failed: ${(error as Error).message}`
      }
    } catch (error) {
      outcome = `open failed: ${(error as Error).message}`
    }
    log(`subifd: ${outcome}`)
    expect(outcome).toBeTruthy()
  })

  it('OME-TIFF with PhysicalSizeY != PhysicalSizeX', async () => {
    const loader = await open('aniso.ome.tif')
    const bounds = loader.tileBounds(0, 0, 1)
    log(
      `aniso: units.micrometersPerPixel=${loader.units.micrometersPerPixel}; tile (0,1) y ${bounds.minY}-${bounds.maxY} um (file: 16-32 um at 1.0 um/px)`,
    )
    expect(loader.units.micrometersPerPixel).toBe(0.5)
  })

  it('planar RGB, LZW + predictor', async () => {
    const loader = await open('planar_rgb.tif')
    const r = await levelPixels(loader, 0, 0, 3)
    const g = await levelPixels(loader, 0, 1, 3)
    const b = await levelPixels(loader, 0, 2, 3)
    const diff =
      diffCount(r, pixels.planar_rgb.r) +
      diffCount(g, pixels.planar_rgb.g) +
      diffCount(b, pixels.planar_rgb.b)
    log(`planar_rgb: ${diff} sample differences over 3 x 40 x 24`)
    expect(diff).toBe(0)
  })

  it('zstd tiles', async () => {
    const loader = await open('zstd.ome.tif')
    let outcome: string
    try {
      const got = await levelPixels(loader, 0)
      outcome = `${diffCount(got, pixels.zstd.pixels)} pixel differences over 48 x 40`
    } catch (error) {
      outcome = `failed: ${(error as Error).message}`
    }
    log(`zstd: ${outcome}`)
    expect(outcome).toBeTruthy()
  })

  it('float32 tiles (docs: float images fail)', async () => {
    let outcome: string
    try {
      const loader = await open('float32.ome.tif')
      const bytes = await loader.fetchTileBytes(0, 0, 0)
      const decoded = await decodeTiffTilePixels(bytes, loader.tileDecodeOptions(0, 0, 0))
      outcome = `decoded ${decoded.pixels.constructor.name} first=${String(decoded.pixels[0])}`
    } catch (error) {
      outcome = `failed: ${(error as Error).message}`
    }
    log(`float32: ${outcome}`)
    expect(outcome).toBeTruthy()
  })

  it('int16 tiles (SampleFormat 2)', async () => {
    const loader = await open('int16.ome.tif')
    const got = await levelPixels(loader, 0)
    log(
      `int16: first row from loader ${got[0]?.slice(0, 4).join(',')}; file ${pixels.int16.pixels[0]?.slice(0, 4).join(',')}; ${diffCount(got, pixels.int16.pixels)} of 1024 differ; channel contrast ${JSON.stringify(loader.channels[0]?.contrast)}`,
    )
    expect(got).toBeTruthy()
  })

  it('uncompressed tiles without a Compression tag (TIFF default 1)', async () => {
    let outcome: string
    try {
      const loader = await open('no_compression_tag.tif')
      const got = await levelPixels(loader, 0)
      outcome = `${diffCount(got, pixels.no_compression_tag.pixels)} of 1024 differ`
    } catch (error) {
      outcome = `failed: ${(error as Error).message}`
    }
    log(`no_compression_tag: ${outcome}`)
    expect(outcome).toBeTruthy()
  })
})
