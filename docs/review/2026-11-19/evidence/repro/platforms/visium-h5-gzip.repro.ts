// A gzipped 10x .h5 named by a standard Visium manifest. The docs say ".gz
// copies of any file work when a dataset manifest names them"
// (docs/host-your-own-data.md, docs/dataset-manifest.md#standard-visium).
//
// Run:
//   npx vitest run --config docs/review/2026-11-19/evidence/repro/vitest.repro.config.ts \
//     docs/review/2026-11-19/evidence/repro/platforms/visium-h5-gzip.repro.ts
import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { setDatasetManifest } from '../../../../../../src/data/datasetFiles'
import {
  createSpatialDataset,
  detectSpatialDataset,
} from '../../../../../../src/datasets/datasetFactory'
import { createH5Bytes } from '../../../../../../src/test/h5Fixtures'

const BASE = 'https://example.test/review-geo/explorer.json'
const SUPPL = '/review-geo/suppl/'

// 36 lattice spots at 0.5 µm per full-res pixel.
const SPOTS = Array.from({ length: 6 }, (_r, row) =>
  Array.from({ length: 6 }, (_c, k) => {
    const col = (row % 2) + 2 * k
    return {
      barcode: `AAAC${row.toString()}${k.toString()}AAAA-1`,
      row,
      col,
      x: 400 + col * 100,
      y: 300 + row * 100 * Math.sqrt(3),
    }
  }),
).flat()

const POSITIONS = SPOTS.map((s) => `${s.barcode},1,${s.row},${s.col},${s.y},${s.x}`).join(
  '\n',
)

async function matrixH5(): Promise<Uint8Array> {
  const barcodes = SPOTS.map((s) => s.barcode)
  return createH5Bytes((file) => {
    const matrix = file.create_group('matrix')
    const features = matrix.create_group('features')
    matrix.create_dataset({ name: 'barcodes', data: barcodes })
    features.create_dataset({ name: 'name', data: ['GENEA'] })
    features.create_dataset({ name: 'id', data: ['ENSG01'] })
    features.create_dataset({ name: 'feature_type', data: ['Gene Expression'] })
    matrix.create_dataset({ name: 'data', data: new Int32Array(barcodes.map(() => 3)) })
    matrix.create_dataset({
      name: 'indices',
      data: new BigInt64Array(barcodes.map(() => 0n)),
    })
    matrix.create_dataset({
      name: 'indptr',
      data: new BigInt64Array(
        Array.from({ length: barcodes.length + 1 }, (_v, i) => BigInt(i)),
      ),
    })
  })
}

function fetcherFor(bodies: Readonly<Record<string, Uint8Array | string>>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const body = bodies[url.pathname]

    if (body === undefined) {
      return new Response(null, { status: 404 })
    }

    if (init?.method === 'HEAD') {
      return new Response(null, { status: 200 })
    }

    return new Response(typeof body === 'string' ? body : body.slice(), { status: 200 })
  }) as typeof fetch
}

afterEach(() => {
  setDatasetManifest(BASE, undefined)
})

describe('VIS gzipped .h5 matrix named in a manifest', () => {
  for (const gzipped of [false, true]) {
    it(`loads filtered_feature_bc_matrix.h5${gzipped ? '.gz' : ''}`, async () => {
      const h5 = await matrixH5()
      const matrixName = `GSM1_filtered_feature_bc_matrix.h5${gzipped ? '.gz' : ''}`
      const manifest = {
        version: 1,
        platform: 'visium',
        root: 'suppl/',
        files: {
          tissuePositions: 'GSM1_tissue_positions_list.csv.gz',
          scalefactors: 'GSM1_scalefactors_json.json.gz',
          filteredMatrix: matrixName,
        },
      }
      const fetcher = fetcherFor({
        '/review-geo/explorer.json': JSON.stringify(manifest),
        [`${SUPPL}GSM1_tissue_positions_list.csv.gz`]: gzipSync(POSITIONS),
        [`${SUPPL}GSM1_scalefactors_json.json.gz`]: gzipSync(
          JSON.stringify({ tissue_hires_scalef: 0.2, spot_diameter_fullres: 130 }),
        ),
        [`${SUPPL}${matrixName}`]: gzipped ? gzipSync(h5) : h5,
      })

      const detection = await detectSpatialDataset(BASE, { fetcher })
      const dataset = await createSpatialDataset(BASE, { fetcher })
      const outcome = await dataset.overview().then(
        (cells) => ({ ok: true, cells: cells.length }),
        (cause: unknown) => ({
          ok: false,
          error:
            cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause),
        }),
      )
      console.log(
        JSON.stringify({
          matrixName,
          detected: detection.platform === 'visium' ? detection.files : null,
          outcome,
        }),
      )
      // Documented contract: both load the same 36 spots.
      expect(outcome).toEqual({ ok: true, cells: 36 })
    })
  }
})
