// MERSCOPE .vzg image placement: micron_to_mosaic_pixel_transform.csv
// (review 2026-11-19). Expected bounds are computed by hand from the
// transform: pixel p maps to micrometres (p - t) / s per axis.
//   npx vitest run --config docs/review/2026-11-19/evidence/repro/vitest.repro.config.ts \
//     docs/review/2026-11-19/evidence/repro/platforms/merscope-vzg-placement.repro.ts
// Fixtures: src/test/fixtures/merscope/region_0.vzg (transform "2 0 -2000 /
// 0 2 -4000", 200 x 160 px, 32 px tiles, manifest bbox 1000,2000,1100,2080)
// and docs/review/2026-11-19/evidence/fixtures/platforms/merscope-anisotropic.vzg
// (same entries, transform "2 0 -2000 / 0 4 -12000"; see its generator).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MerscopeDataset } from '../../../../../../src/datasets/merscopeDataset'

const ROOT = 'https://example.test/region'

function fetcherFor(vzgPath: string): typeof fetch {
  const files: Record<string, Uint8Array> = {
    'cell_by_gene.csv': new Uint8Array(
      readFileSync(join(process.cwd(), 'src/test/fixtures/merscope/cell_by_gene.csv')),
    ),
    'cell_metadata.csv': new Uint8Array(
      readFileSync(join(process.cwd(), 'src/test/fixtures/merscope/cell_metadata.csv')),
    ),
    'region_0.vzg': new Uint8Array(readFileSync(join(process.cwd(), vzgPath))),
  }

  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    const bytes = files[url.slice(ROOT.length + 1)]

    if (bytes === undefined) {
      return new Response(null, { status: 404 })
    }

    if (init?.method === 'HEAD') {
      return new Response(null, {
        headers: { 'Content-Length': String(bytes.byteLength) },
      })
    }

    const range = /bytes=(\d+)-(\d+)?/.exec(new Headers(init?.headers).get('Range') ?? '')

    if (range !== null) {
      const start = Number(range[1])
      const end = range[2] === undefined ? bytes.byteLength : Number(range[2]) + 1
      return new Response(bytes.slice(start, end), {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end - 1}/${bytes.byteLength}`,
          'Content-Length': String(end - start),
        },
      })
    }

    return new Response(bytes.slice(), {
      headers: { 'Content-Length': String(bytes.byteLength) },
    })
  }) as typeof fetch
}

async function corners(vzgPath: string) {
  const dataset = new MerscopeDataset({
    baseUrl: ROOT,
    files: {
      cellByGene: `${ROOT}/cell_by_gene.csv`,
      cellMetadata: `${ROOT}/cell_metadata.csv`,
      vzg: `${ROOT}/region_0.vzg`,
    },
    fetcher: fetcherFor(vzgPath),
  })
  const options = await dataset.imageOptions()
  const source = await dataset.imageSource({ stain: 'DAPI', z: 3 })

  if (source.kind !== 'pyramid') {
    throw new Error('expected a pyramid')
  }

  // Level 0 is 200 x 160 px in 32 px tiles: columns 0-6, rows 0-4.
  const first = source.loader.tileBounds(0, 0, 0)
  const last = source.loader.tileBounds(0, 6, 4)
  const result = { placement: options?.placement, first, last }
  console.log(`[placement] ${vzgPath}: ${JSON.stringify(result)}`)
  return result
}

describe('MERSCOPE .vzg placement', () => {
  it('isotropic transform: image spans the manifest bbox exactly', async () => {
    const { first, last } = await corners('src/test/fixtures/merscope/region_0.vzg')
    // x = (p + 2000) / 2, y = (p + 4000) / 2.
    expect(first).toEqual({ minX: 1000, maxX: 1016, minY: 2000, maxY: 2016 })
    expect(last).toEqual({ minX: 1096, maxX: 1100, minY: 2064, maxY: 2080 })
  })

  it('anisotropic transform (sx 2, sy 4, tx -2000, ty -12000): per-axis pixel size', async () => {
    const { first, last } = await corners(
      'docs/review/2026-11-19/evidence/fixtures/platforms/merscope-anisotropic.vzg',
    )
    // x = (p + 2000) / 2 -> 0.5 um/px from 1000; y = (p + 12000) / 4 -> 0.25 um/px from 3000.
    expect(first.minX).toBe(1000)
    expect(first.minY).toBe(3000)
    expect({ maxX: last.maxX, maxY: last.maxY }).toEqual({ maxX: 1100, maxY: 3040 })
  })
})
