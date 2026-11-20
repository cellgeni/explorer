// Standard Visium (Space Ranger outs/) reader reproductions for the
// 2026-11-19 review. Expected values are hand-computed from the Space Ranger
// file contracts, not from production helpers.
//
// Run:
//   npx vitest run --config docs/review/2026-11-19/evidence/repro/vitest.repro.config.ts \
//     docs/review/2026-11-19/evidence/repro/platforms/visium-readers.repro.ts
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { overviewCellMetadata } from '../../../../../../src/data/cellMetadata'
import { createVisiumDataset } from '../../../../../../src/datasets/visiumDataset'
import type { VisiumFileUrls } from '../../../../../../src/datasets/visiumDataset'
import { drawFlatImage } from '../../../../../../src/rendering/morphologyCanvas'
import { createH5Bytes } from '../../../../../../src/test/h5Fixtures'

const ROOT = 'https://example.test/review/visium/outs'
// Chosen scale (µm per full-res pixel) and an asymmetric origin, so that a
// swapped axis or a doubled scale shows.
const UM_PER_PX = 0.3236
const X0 = 3000 // pxl_col_in_fullres of array (0, 0)
const Y0 = 1000 // pxl_row_in_fullres of array (0, 0)

interface Spot {
  readonly barcode: string
  readonly row: number
  readonly col: number
  readonly pxlRow: number
  readonly pxlCol: number
}

// 6 x 6 Visium lattice: one column index is 50 µm, one row 100*sqrt(3)/2 µm.
const SPOTS: readonly Spot[] = Array.from({ length: 6 }, (_r, row) =>
  Array.from({ length: 6 }, (_c, k) => {
    const col = (row % 2) + 2 * k
    return {
      barcode: `AAAC${row.toString()}${k.toString()}AAAA-1`,
      row,
      col,
      pxlCol: X0 + (col * 50) / UM_PER_PX,
      pxlRow: Y0 + (row * 50 * Math.sqrt(3)) / UM_PER_PX,
    }
  }),
).flat()

const SCALEFACTORS = {
  spot_diameter_fullres: 65 / UM_PER_PX,
  fiducial_diameter_fullres: 100,
  tissue_hires_scalef: 0.1,
  tissue_lowres_scalef: 0.03,
}

const HEADER =
  'barcode,in_tissue,array_row,array_col,pxl_row_in_fullres,pxl_col_in_fullres'

function positionsCsv(
  spots: readonly Spot[],
  options: {
    header?: 'standard' | 'reordered' | 'none'
    inTissue?: (s: Spot) => number
  } = {},
): string {
  const inTissue = options.inTissue ?? (() => 1)
  const header = options.header ?? 'standard'

  if (header === 'reordered') {
    return [
      'pxl_col_in_fullres,barcode,pxl_row_in_fullres,array_col,in_tissue,array_row',
      ...spots.map(
        (s) => `${s.pxlCol},${s.barcode},${s.pxlRow},${s.col},${inTissue(s)},${s.row}`,
      ),
    ].join('\n')
  }

  return [
    ...(header === 'standard' ? [HEADER] : []),
    ...spots.map(
      (s) => `${s.barcode},${inTissue(s)},${s.row},${s.col},${s.pxlRow},${s.pxlCol}`,
    ),
  ].join('\n')
}

function fetcherFor(files: Readonly<Record<string, string | Uint8Array>>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input)
    const body = files[url]

    if (body === undefined) {
      return new Response(null, { status: 404 })
    }

    return new Response(typeof body === 'string' ? body : body.slice(), { status: 200 })
  }) as typeof fetch
}

const MEX = `${ROOT}/filtered_feature_bc_matrix`

function mexUrls(overrides: Partial<VisiumFileUrls> = {}): VisiumFileUrls {
  return {
    tissuePositions: [`${ROOT}/spatial/tissue_positions.csv`],
    scalefactors: `${ROOT}/spatial/scalefactors_json.json`,
    filteredMatrix: `${MEX}/matrix.mtx.gz`,
    filteredMatrixMex: {
      barcodes: `${MEX}/barcodes.tsv.gz`,
      features: `${MEX}/features.tsv.gz`,
    },
    images: { hires: `${ROOT}/spatial/tissue_hires_image.png` },
    analysis: {},
    ...overrides,
  }
}

// features x barcodes, 1-based, as Space Ranger writes it.
function mtx(
  featureCount: number,
  barcodeCount: number,
  entries: readonly string[],
): Uint8Array {
  return gzipSync(
    [
      '%%MatrixMarket matrix coordinate integer general',
      `${featureCount.toString()} ${barcodeCount.toString()} ${entries.length.toString()}`,
      ...entries,
    ].join('\n'),
  )
}

// Feature 1 = 7 counts in every barcode (1-based), feature 2 = 2 counts in
// barcode 1 only.
function standardMexFiles(
  barcodes: readonly string[],
  features: readonly string[],
): Record<string, Uint8Array> {
  const entries = barcodes.flatMap((_b, index) => [
    `1 ${(index + 1).toString()} 7`,
    ...(index === 0 ? [`2 1 2`] : []),
  ])
  return {
    [`${MEX}/matrix.mtx.gz`]: mtx(features.length, barcodes.length, entries),
    [`${MEX}/barcodes.tsv.gz`]: gzipSync(barcodes.join('\n')),
    [`${MEX}/features.tsv.gz`]: gzipSync(features.join('\n')),
  }
}

const FEATURES_3 = [
  'ENSG01\tGENEA\tGene Expression',
  'ENSG02\tGENEB\tGene Expression',
  'ENSG03\tGENEC\tGene Expression',
]

function baseFiles(positions: string): Record<string, string | Uint8Array> {
  return {
    [`${ROOT}/spatial/tissue_positions.csv`]: positions,
    [`${ROOT}/spatial/tissue_positions_list.csv`]: positions,
    [`${ROOT}/spatial/scalefactors_json.json`]: JSON.stringify(SCALEFACTORS),
  }
}

describe('VIS axis order, scale, and image alignment', () => {
  for (const header of ['standard', 'none', 'reordered'] as const) {
    it(`places pxl_col as x and pxl_row as y (${header} header), scale applied once`, async () => {
      const positionsPath =
        header === 'none'
          ? `${ROOT}/spatial/tissue_positions_list.csv`
          : `${ROOT}/spatial/tissue_positions.csv`
      const dataset = createVisiumDataset({
        baseUrl: ROOT,
        files: mexUrls({ tissuePositions: [positionsPath] }),
        fetcher: fetcherFor({
          ...baseFiles(positionsCsv(SPOTS, { header })),
          ...standardMexFiles(
            SPOTS.map((s) => s.barcode),
            FEATURES_3,
          ),
        }),
      })
      const [meta, summary, cells] = await Promise.all([
        dataset.meta(),
        dataset.visiumSummary(),
        dataset.overview(),
      ])
      const first = cells.find((cell) => cell.cellId === SPOTS[0]?.barcode)
      // Hand-computed: (3000 px, 1000 px) x 0.3236 µm/px.
      console.log(
        JSON.stringify({
          header,
          units: summary?.units,
          first: first?.position,
          spotCount: summary?.spotCount,
        }),
      )
      expect(summary?.units.source).toBe('spot-grid')
      expect(meta.units.micrometersPerPixel).toBeCloseTo(0.3236, 6)
      expect(first?.position.x).toBeCloseTo(970.8, 6)
      expect(first?.position.y).toBeCloseTo(323.6, 6)
      expect(summary?.spotDiameterMicrometers).toBe(55)
    })
  }

  it('draws hires pixel p at the same screen point as a spot at full-res p / scalef', async () => {
    const dataset = createVisiumDataset({
      baseUrl: ROOT,
      files: mexUrls(),
      fetcher: fetcherFor({
        ...baseFiles(positionsCsv(SPOTS)),
        ...standardMexFiles(
          SPOTS.map((s) => s.barcode),
          FEATURES_3,
        ),
      }),
    })
    const [meta, image] = await Promise.all([
      dataset.meta(),
      dataset.tissueImage('hires'),
    ])
    expect(image).toMatchObject({ kind: 'flat', scaleFactor: 0.1 })

    // A 1000 x 600 hires PNG; full-res is 10000 x 6000 px.
    const calls: number[][] = []
    const context = {
      clearRect: () => undefined,
      drawImage: (...args: unknown[]) => {
        calls.push(args.slice(1) as number[])
      },
    } as unknown as CanvasRenderingContext2D
    const viewState = {
      target: [500, 300, 0] as [number, number, number],
      zoom: -1,
      minZoom: -10,
      maxZoom: 10,
    }
    const viewport = { width: 800, height: 600 }
    drawFlatImage(
      context,
      {
        image: {} as CanvasImageSource,
        size: [1000, 600],
        scaleFactor: 0.1,
        micrometersPerPixel: meta.units.micrometersPerPixel,
      },
      viewState,
      viewport,
    )
    const [, , sw, sh, dx, dy, dw, dh] = calls[0] ?? []
    // Hires pixel (300, 100) == full-res (3000, 1000) == spot AAAC00AAAA-1.
    const imageScreen = {
      x: (dx ?? 0) + (300 / (sw ?? 1)) * (dw ?? 0),
      y: (dy ?? 0) + (100 / (sh ?? 1)) * (dh ?? 0),
    }
    // deck.gl OrthographicView, flipY false: spots are drawn at deck
    // (x, -y); screen = centre + (deck - target) * 2^zoom with screen y down.
    const scale = 2 ** viewState.zoom
    const spotDeck = { x: 970.8, y: -323.6 }
    const spotScreen = {
      x: viewport.width / 2 + (spotDeck.x - viewState.target[0]) * scale,
      y: viewport.height / 2 - (spotDeck.y - viewState.target[1]) * scale,
    }
    console.log(JSON.stringify({ drawImage: calls[0], imageScreen, spotScreen }))
    expect(imageScreen.x).toBeCloseTo(spotScreen.x, 6)
    expect(imageScreen.y).toBeCloseTo(spotScreen.y, 6)
  })
})

describe('VIS H5 matrix (CSC: indptr per barcode, indices = feature)', () => {
  it('reads counts by barcode and feature, keeping feature ids', async () => {
    const barcodes = SPOTS.map((s) => s.barcode)
    // barcode 0: GENEB=4; barcode 1: GENEA=1, GENEC=9; others: GENEA=3.
    const indices: number[] = []
    const data: number[] = []
    const indptr: bigint[] = [0n]
    barcodes.forEach((_b, index) => {
      if (index === 0) {
        indices.push(1)
        data.push(4)
      } else if (index === 1) {
        indices.push(0, 2)
        data.push(1, 9)
      } else {
        indices.push(0)
        data.push(3)
      }
      indptr.push(BigInt(indices.length))
    })
    const h5 = await createH5Bytes((file) => {
      file.create_attribute('library_ids', ['lib-1'])
      const matrix = file.create_group('matrix')
      const features = matrix.create_group('features')
      matrix.create_dataset({ name: 'barcodes', data: barcodes })
      features.create_dataset({ name: 'name', data: ['GENEA', 'GENEB', 'GENEC'] })
      features.create_dataset({ name: 'id', data: ['ENSG01', 'ENSG02', 'ENSG03'] })
      features.create_dataset({
        name: 'feature_type',
        data: ['Gene Expression', 'Gene Expression', 'Gene Expression'],
      })
      matrix.create_dataset({ name: 'data', data: new Int32Array(data) })
      matrix.create_dataset({
        name: 'indices',
        data: new BigInt64Array(indices.map(BigInt)),
      })
      matrix.create_dataset({ name: 'indptr', data: new BigInt64Array(indptr) })
      matrix.create_dataset({ name: 'shape', data: new Int32Array([3, barcodes.length]) })
    })
    const dataset = createVisiumDataset({
      baseUrl: ROOT,
      files: {
        tissuePositions: [`${ROOT}/spatial/tissue_positions.csv`],
        scalefactors: `${ROOT}/spatial/scalefactors_json.json`,
        filteredMatrix: `${ROOT}/filtered_feature_bc_matrix.h5`,
        images: {},
        analysis: {},
      },
      fetcher: fetcherFor({
        ...baseFiles(positionsCsv(SPOTS)),
        [`${ROOT}/filtered_feature_bc_matrix.h5`]: h5,
      }),
    })
    const profile = await dataset.matrix([barcodes[0] ?? '', barcodes[1] ?? ''])
    const summary = await dataset.visiumSummary()
    console.log(
      JSON.stringify({
        b0: profile.cells.get(barcodes[0] ?? ''),
        b1: profile.cells.get(barcodes[1] ?? ''),
        libraryId: summary?.libraryId,
      }),
    )
    expect(profile.cells.get(barcodes[0] ?? '')).toEqual({
      geneNames: ['GENEB'],
      counts: [4],
    })
    expect(profile.cells.get(barcodes[1] ?? '')).toEqual({
      geneNames: ['GENEA', 'GENEC'],
      counts: [1, 9],
    })
    expect(summary?.libraryId).toBe('lib-1')
  })
})

describe('VIS MEX 1-based coordinates and joins', () => {
  it('maps "row col value" to feature row-1, barcode col-1', async () => {
    const barcodes = SPOTS.map((s) => s.barcode)
    const dataset = createVisiumDataset({
      baseUrl: ROOT,
      files: mexUrls(),
      fetcher: fetcherFor({
        ...baseFiles(positionsCsv(SPOTS)),
        ...standardMexFiles(barcodes, FEATURES_3),
      }),
    })
    const profile = await dataset.matrix([barcodes[0] ?? '', barcodes[1] ?? ''])
    console.log(JSON.stringify([...profile.cells.entries()]))
    // Entry "2 1 2" = feature 2 (GENEB) in barcode 1 (the first).
    expect(profile.cells.get(barcodes[0] ?? '')).toEqual({
      geneNames: ['GENEA', 'GENEB'],
      counts: [7, 2],
    })
    expect(profile.cells.get(barcodes[1] ?? '')).toEqual({
      geneNames: ['GENEA'],
      counts: [7],
    })
  })

  it('drops matrix barcodes without positions and does not show positions without counts', async () => {
    const matrixBarcodes = [
      ...SPOTS.slice(0, 30).map((s) => s.barcode),
      'TTTTTTTTTTTTTTTT-1',
    ]
    const progress: string[] = []
    const dataset = createVisiumDataset({
      baseUrl: ROOT,
      files: mexUrls(),
      fetcher: fetcherFor({
        ...baseFiles(positionsCsv(SPOTS)),
        ...standardMexFiles(matrixBarcodes, FEATURES_3),
      }),
      onProgress: (message) => progress.push(message),
    })
    const cells = await dataset.overview()
    console.log(
      JSON.stringify({
        shown: cells.length,
        progress: progress.filter((m) => /not in the tissue/.test(m)),
      }),
    )
    expect(cells).toHaveLength(30)
    expect(
      progress.some((m) => /1 matrix barcodes are not in the tissue positions/.test(m)),
    ).toBe(true)
  })

  it('fails with a clear error when matrix barcodes lack the -1 suffix of the positions file', async () => {
    const dataset = createVisiumDataset({
      baseUrl: ROOT,
      files: mexUrls(),
      fetcher: fetcherFor({
        ...baseFiles(positionsCsv(SPOTS)),
        ...standardMexFiles(
          SPOTS.map((s) => s.barcode.replace(/-1$/, '')),
          FEATURES_3,
        ),
      }),
    })
    const error = await dataset.overview().then(
      () => null,
      (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)),
    )
    console.log(JSON.stringify({ error }))
    expect(error).toMatch(
      /None of the filtered matrix barcodes are in the Visium tissue positions file/,
    )
  })

  it('duplicate barcode rows in the positions file: the last row wins, silently', async () => {
    const duplicate = { ...SPOTS[0]!, pxlCol: 9999, pxlRow: 8888 }
    const progress: string[] = []
    const dataset = createVisiumDataset({
      baseUrl: ROOT,
      files: mexUrls(),
      fetcher: fetcherFor({
        ...baseFiles(positionsCsv([...SPOTS, duplicate])),
        ...standardMexFiles(
          SPOTS.map((s) => s.barcode),
          FEATURES_3,
        ),
      }),
      onProgress: (message) => progress.push(message),
    })
    const cells = await dataset.overview()
    const first = cells.find((cell) => cell.cellId === SPOTS[0]?.barcode)
    console.log(
      JSON.stringify({
        first: first?.position,
        warned: progress.some((m) => /duplicate/i.test(m)),
      }),
    )
    expect(first?.position.x).toBeCloseTo(
      9999 * (await dataset.meta()).units.micrometersPerPixel,
      3,
    )
  })
})

describe('VIS in_tissue handling', () => {
  it('raw matrix with off-tissue spots: hidden by default, shown on request, scale unchanged', async () => {
    const offTissue = (s: Spot) => (s.row === 5 ? 0 : 1)
    const barcodes = SPOTS.map((s) => s.barcode)
    const dataset = createVisiumDataset({
      baseUrl: ROOT,
      files: mexUrls(),
      fetcher: fetcherFor({
        ...baseFiles(positionsCsv(SPOTS, { inTissue: offTissue })),
        ...standardMexFiles(barcodes, FEATURES_3),
      }),
    })
    const hidden = await dataset.visiumSummary()
    const hiddenCells = (await dataset.overview()).length
    dataset.setVisiumView({ showOffTissue: true })
    const shown = await dataset.visiumSummary()
    const shownCells = (await dataset.overview()).length
    console.log(
      JSON.stringify({
        hidden: {
          spotCount: hidden?.spotCount,
          off: hidden?.offTissueSpotCount,
          cells: hiddenCells,
          umpp: hidden?.units.micrometersPerPixel,
        },
        shown: {
          spotCount: shown?.spotCount,
          cells: shownCells,
          umpp: shown?.units.micrometersPerPixel,
        },
      }),
    )
    expect(hidden?.spotCount).toBe(30)
    expect(hidden?.offTissueSpotCount).toBe(6)
    expect(hiddenCells).toBe(30)
    expect(shownCells).toBe(36)
    expect(shown?.units.micrometersPerPixel).toBeCloseTo(0.3236, 6)
  })
})

describe('VIS feature types and names', () => {
  it('Antibody Capture counts go into total_counts and n_genes_by_counts', async () => {
    const barcodes = SPOTS.map((s) => s.barcode)
    // Barcode 1: GENEA 7, GENEB 2 (Gene Expression) and CD3 500 (Antibody
    // Capture). Gene-expression-only QC (scanpy read_visium gex_only=True,
    // Space Ranger "UMIs per spot" metrics) gives total 9 and 2 genes.
    const entries = barcodes.flatMap((_b, index) => [
      `1 ${(index + 1).toString()} 7`,
      ...(index === 0 ? ['2 1 2', '3 1 500'] : []),
    ])
    const dataset = createVisiumDataset({
      baseUrl: ROOT,
      files: mexUrls(),
      fetcher: fetcherFor({
        ...baseFiles(positionsCsv(SPOTS)),
        [`${MEX}/matrix.mtx.gz`]: mtx(3, barcodes.length, entries),
        [`${MEX}/barcodes.tsv.gz`]: gzipSync(barcodes.join('\n')),
        [`${MEX}/features.tsv.gz`]: gzipSync(
          [
            'ENSG01\tGENEA\tGene Expression',
            'ENSG02\tGENEB\tGene Expression',
            'CD3\tCD3\tAntibody Capture',
          ].join('\n'),
        ),
      }),
    })
    const cells = await dataset.overview()
    const first = cells.find((cell) => cell.cellId === barcodes[0])
    const metadata = first === undefined ? undefined : overviewCellMetadata(first)
    console.log(
      JSON.stringify({
        total_counts: metadata?.total_counts,
        n_genes_by_counts: metadata?.n_genes_by_counts,
        genePanel: await dataset.genePanel(),
      }),
    )
    expect(metadata?.total_counts).toBe(509)
    expect(metadata?.n_genes_by_counts).toBe(3)
  })

  it('duplicate symbols get -2; Ensembl ids are not kept as aliases', async () => {
    const barcodes = SPOTS.map((s) => s.barcode)
    const dataset = createVisiumDataset({
      baseUrl: ROOT,
      files: mexUrls(),
      fetcher: fetcherFor({
        ...baseFiles(positionsCsv(SPOTS)),
        ...standardMexFiles(barcodes, [
          'ENSG00000284770\tTBCE\tGene Expression',
          'ENSG00000285053\tTBCE\tGene Expression',
          'ENSG03\tGENEC\tGene Expression',
        ]),
      }),
    })
    const genePanel = await dataset.genePanel()
    const aliases = await dataset.geneAliases()
    console.log(JSON.stringify({ genePanel, aliases: [...aliases.entries()] }))
    expect(genePanel).toEqual(['TBCE', 'TBCE-2', 'GENEC'])
    expect(aliases.size).toBe(0)
  })
})
