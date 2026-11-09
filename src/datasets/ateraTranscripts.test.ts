import { describe, expect, it } from 'vitest'
import { micrometers, type BBox } from '../data/coords'
import {
  array,
  deltaArray,
  group,
  mapStore,
  matrixArray,
  storedZip,
  type ZarrEntries,
} from '../test/ateraFixtures'
import { AteraTranscripts } from './ateraTranscripts'

const BINNED_URL = 'https://example.test/atera/binned_transcripts.zarr.zip'
const TRANSCRIPTS_URL = 'https://example.test/atera/transcripts.zarr.zip'
const GENES = ['GENEA', 'GENEB', 'GENEC']
const UNASSIGNED = 0xffff_ffff

function bbox(minX: number, minY: number, maxX: number, maxY: number): BBox {
  return {
    minX: micrometers(minX),
    minY: micrometers(minY),
    maxX: micrometers(maxX),
    maxY: micrometers(maxY),
  }
}

// 20 µm tiles of 4×4 native 5 µm bins. GENEC has no transcripts, so no zip.
//   GENEA tile (0,0): (row 0, col 0) 2, (row 0, col 3) 1, (row 2, col 1) 4
//   GENEA tile (-1,0): (row 1, col 3) 6
//   GENEB tile (0,0): (row 1, col 0) 3
function binnedStore(): ZarrEntries {
  const entries: ZarrEntries = new Map()
  group(entries, '', {
    name: 'BinnedTranscripts',
    gene_names: GENES,
    gene_counts: [13, 3, 0],
    grid_size: 20,
    grid_keys: ['-1,0', '0,0'],
    origin: { x: 0, y: 0 },
  })
  group(entries, 'gene', {})
  entries.set(
    'gene/0.zip',
    storedZip(
      binnedGene(0, {
        '0,0': { indptr: [0, 2, 2, 3, 3], indices: [0, 3, 1], data: [2, 1, 4] },
        '-1,0': { indptr: [0, 0, 1, 1, 1], indices: [3], data: [6] },
      }),
    ),
  )
  entries.set(
    'gene/1.zip',
    storedZip(
      binnedGene(1, { '0,0': { indptr: [0, 0, 1, 1, 1], indices: [0], data: [3] } }),
    ),
  )
  return entries
}

function binnedGene(
  geneIndex: number,
  tiles: Readonly<
    Record<
      string,
      { readonly indptr: number[]; readonly indices: number[]; readonly data: number[] }
    >
  >,
): ZarrEntries {
  const entries: ZarrEntries = new Map()
  entries.set(
    '.zattrs',
    new TextEncoder().encode(JSON.stringify({ gene_index: geneIndex })),
  )
  group(entries, 'grid', {
    rows: 4,
    cols: 4,
    grid_keys: Object.keys(tiles),
    grid_key_names: ['grid_x_loc', 'grid_y_loc'],
  })

  for (const [key, tile] of Object.entries(tiles)) {
    group(entries, `grid/${key}`, { rows: 4, cols: 4 })
    deltaArray(entries, `grid/${key}/indptr`, '<u4', tile.indptr)
    deltaArray(entries, `grid/${key}/indices`, '<u2', tile.indices)
    array(entries, `grid/${key}/data`, '<u4', tile.data)
  }

  return entries
}

// Rows sorted by gene, with gene_offset giving each gene's [start, end).
// Quality scores are float16 bits: 0x5100 = 40, 0x4900 = 10, 0x5010 = 32.5,
// 0x4e60 = 25.5, 0x4d00 = 20, 0x4f80 = 30. Cell prefix 0 is aaaaaaaa-1.
const TILE_ROWS: Readonly<
  Record<
    string,
    {
      readonly offsets: readonly (readonly [number, number])[]
      readonly rows: readonly {
        readonly location: readonly [number, number, number]
        readonly qv: number
        readonly cell: readonly [number, number]
        readonly nucleus: number
      }[]
    }
  >
> = {
  '0,0': {
    offsets: [
      [0, 3],
      [3, 5],
      [5, 5],
    ],
    rows: [
      { location: [2, 2, 1.5], qv: 0x5100, cell: [0, 1], nucleus: 1 },
      { location: [12, 3, 1], qv: 0x4900, cell: [UNASSIGNED, UNASSIGNED], nucleus: 0 },
      { location: [17, 17, 2], qv: 0x5010, cell: [UNASSIGNED, UNASSIGNED], nucleus: 0 },
      { location: [4, 6, 1], qv: 0x4e60, cell: [1, 1], nucleus: 0 },
      { location: [8, 8, 1], qv: 0x4d00, cell: [0, 1], nucleus: 1 },
    ],
  },
  '-1,0': {
    offsets: [
      [0, 1],
      [1, 1],
      [1, 1],
    ],
    rows: [
      { location: [-5, 5, 3], qv: 0x4f80, cell: [UNASSIGNED, UNASSIGNED], nucleus: 0 },
    ],
  },
}

function transcriptStore(): ZarrEntries {
  const entries: ZarrEntries = new Map()
  group(entries, '', { name: 'RnaDataset', gene_names: GENES, number_genes: 3 })
  group(entries, 'grid', { grid_size: 20, grid_keys: ['0,0', '-1,0'] })

  for (const [key, tile] of Object.entries(TILE_ROWS)) {
    const path = `grid/${key}`
    group(entries, path, {})
    matrixArray(
      entries,
      `${path}/gene_offset`,
      '<u4',
      tile.offsets.map((row) => [...row]),
      {
        chunkRows: tile.offsets.length,
      },
    )
    matrixArray(
      entries,
      `${path}/location`,
      '<f4',
      tile.rows.map((row) => [...row.location]),
      {
        chunkRows: 2,
        order: 'F',
      },
    )
    matrixArray(
      entries,
      `${path}/quality_score`,
      '<f2',
      tile.rows.map((row) => [row.qv]),
      {
        chunkRows: 4,
      },
    )
    matrixArray(
      entries,
      `${path}/cell_id`,
      '<u4',
      tile.rows.map((row) => [...row.cell]),
      {
        chunkRows: 2,
        order: 'F',
      },
    )
    matrixArray(
      entries,
      `${path}/overlaps_nucleus`,
      '|u1',
      tile.rows.map((row) => [row.nucleus]),
      { chunkRows: 8 },
    )
  }

  return entries
}

function createReader(options: { readonly withTranscripts?: boolean } = {}) {
  const stores = new Map<string, ZarrEntries>([[BINNED_URL, binnedStore()]])

  if (options.withTranscripts !== false) {
    stores.set(TRANSCRIPTS_URL, transcriptStore())
  }

  const requestedKeys: string[] = []
  const reader = new AteraTranscripts({
    binned: async () => ({ url: BINNED_URL, label: 'binned_transcripts.zarr.zip' }),
    transcripts: async () => ({ url: TRANSCRIPTS_URL, label: 'transcripts.zarr.zip' }),
    openZipStore: async (url) => {
      const entries = stores.get(url)

      if (entries === undefined) {
        throw new Error(`No fixture for ${url}`)
      }

      return { store: mapStore(entries, requestedKeys, url.split('/').pop()) }
    },
  })

  return { reader, requestedKeys }
}

describe('AteraTranscripts', () => {
  it('reports per-gene density and exact ranges when both stores open', async () => {
    await expect(createReader().reader.capabilities()).resolves.toEqual({
      rawParquet: false,
      nativeZarr: true,
      geneRanges: true,
    })
    await expect(
      createReader({ withTranscripts: false }).reader.capabilities(),
    ).resolves.toEqual({
      rawParquet: false,
      nativeZarr: true,
      geneRanges: false,
      geneRangesError: `No fixture for ${TRANSCRIPTS_URL}`,
    })
  })

  it('sums selected genes into 5 µm density squares and counts them in the box', async () => {
    const { reader, requestedKeys } = createReader()
    const result = await reader.aggregates(bbox(0, 0, 19, 19), {
      featureNames: ['GENEA', 'geneb', 'GENEC', 'MISSING'],
    })

    expect(result.selectedFeatureNames).toEqual(['GENEA', 'GENEB', 'GENEC'])
    expect(result.visibleTranscriptCount).toBe(10)
    expect(result.sourceFile).toBe('binned_transcripts.zarr.zip')
    expect(result.level).toMatchObject({ level: 0, gridSizeMicrometers: 5 })
    expect(result.scaleMax).toBe(4)
    expect(
      result.bins.map((bin) => [bin.binX, bin.binY, bin.count, bin.topFeatures]),
    ).toEqual([
      [0, 0, 2, [{ featureName: 'GENEA', count: 2 }]],
      [3, 0, 1, [{ featureName: 'GENEA', count: 1 }]],
      [0, 1, 3, [{ featureName: 'GENEB', count: 3 }]],
      [1, 2, 4, [{ featureName: 'GENEA', count: 4 }]],
    ])
    expect(result.bins[0]).toMatchObject({
      id: 'atera-binned:0:0:0',
      source: 'native-zarr',
      glyphType: 'density',
      position: { x: 2.5, y: 2.5 },
      binSizeMicrometers: 5,
    })
    expect(requestedKeys.filter((key) => key.includes('gene/'))).toEqual([
      'binned_transcripts.zarr.zip:/gene/0.zip',
      'binned_transcripts.zarr.zip:/gene/1.zip',
      'binned_transcripts.zarr.zip:/gene/2.zip',
    ])
  })

  it('coarsens squares to stay within the bin budget and reaches other tiles', async () => {
    const { reader } = createReader()
    const result = await reader.aggregates(bbox(-20, 0, 19, 19), {
      featureNames: ['GENEA', 'GENEB'],
      maxBins: 2,
    })

    expect(result.level).toMatchObject({ level: 2, gridSizeMicrometers: 20 })
    expect(result.visibleTranscriptCount).toBe(16)
    expect(
      result.bins.map((bin) => [bin.binX, bin.binY, bin.count, bin.topFeatures]),
    ).toEqual([
      [-1, 0, 6, [{ featureName: 'GENEA', count: 6 }]],
      [
        0,
        0,
        10,
        [
          { featureName: 'GENEA', count: 7 },
          { featureName: 'GENEB', count: 3 },
        ],
      ],
    ])
  })

  it('reads exact points for selected genes in the box above the minimum QV', async () => {
    const { reader } = createReader()
    const result = await reader.viewport(bbox(0, 0, 15, 15), {
      featureNames: ['GENEA', 'GENEB'],
      minQv: 20,
    })

    expect(result.hitPointLimit).toBe(false)
    expect(result.points).toEqual([
      {
        id: '0,0:0',
        cellId: 'aaaaaaaa-1',
        cellAssignment: 'known',
        featureName: 'GENEA',
        fovName: null,
        position: { x: 2, y: 2 },
        zLocation: 1.5,
        qv: 40,
        overlapsNucleus: true,
        isGene: true,
      },
      {
        id: '0,0:3',
        cellId: 'aaaaaaab-1',
        cellAssignment: 'known',
        featureName: 'GENEB',
        fovName: null,
        position: { x: 4, y: 6 },
        zLocation: 1,
        qv: 25.5,
        overlapsNucleus: false,
        isGene: true,
      },
      {
        id: '0,0:4',
        cellId: 'aaaaaaaa-1',
        cellAssignment: 'known',
        featureName: 'GENEB',
        fovName: null,
        position: { x: 8, y: 8 },
        zLocation: 1,
        qv: 20,
        overlapsNucleus: true,
        isGene: true,
      },
    ])
    expect(result.groups).toEqual([
      { featureName: 'GENEB', fovName: null, count: 2, meanQv: 22.75 },
      { featureName: 'GENEA', fovName: null, count: 1, meanQv: 40 },
    ])
  })

  it('keeps low-QV and unassigned transcripts when asked, across tiles', async () => {
    const { reader } = createReader()
    const result = await reader.viewport(bbox(-20, 0, 15, 15), {
      featureNames: ['GENEA'],
      minQv: 0,
    })

    expect(
      result.points.map((point) => [
        point.id,
        point.qv,
        point.cellId,
        point.cellAssignment,
      ]),
    ).toEqual([
      ['0,0:0', 40, 'aaaaaaaa-1', 'known'],
      ['0,0:1', 10, null, 'unassigned'],
      ['-1,0:0', 30, null, 'unassigned'],
    ])
  })

  it('returns the first points up to the limit and flags the rest', async () => {
    const { reader } = createReader()
    const all = await reader.viewport(bbox(0, 0, 15, 15), {
      featureNames: ['GENEA', 'GENEB'],
    })
    const result = await reader.viewport(bbox(0, 0, 15, 15), {
      featureNames: ['GENEA', 'GENEB'],
      pointLimit: 2,
    })

    expect(all.points.length).toBeGreaterThan(2)
    expect(result.hitPointLimit).toBe(true)
    expect(result.points.map((point) => point.id)).toEqual(
      all.points.slice(0, 2).map((point) => point.id),
    )
  })

  it('reads only the tiles the box touches and caches gene offsets', async () => {
    const { reader, requestedKeys } = createReader()

    await reader.viewport(bbox(1, 1, 5, 5), { featureNames: ['GENEA'] })
    await reader.viewport(bbox(1, 1, 6, 6), { featureNames: ['GENEA'] })

    expect(requestedKeys.filter((key) => key.includes('-1,0'))).toEqual([])
    expect(
      requestedKeys.filter((key) => key.endsWith('/grid/0,0/gene_offset/0.0')),
    ).toHaveLength(1)
    expect(
      requestedKeys.filter((key) => key.endsWith('/grid/0,0/location/0.0')),
    ).toHaveLength(1)
  })

  it('returns nothing for genes without binned or exact transcripts', async () => {
    const { reader } = createReader()

    await expect(
      reader.aggregates(bbox(0, 0, 19, 19), { featureNames: ['GENEC'] }),
    ).resolves.toMatchObject({ bins: [], visibleTranscriptCount: 0 })
    await expect(
      reader.viewport(bbox(0, 0, 19, 19), { featureNames: ['GENEC'] }),
    ).resolves.toEqual({ points: [], groups: [], hitPointLimit: false })
  })
})
