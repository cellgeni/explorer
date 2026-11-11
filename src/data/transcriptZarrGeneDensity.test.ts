import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  array,
  group,
  json,
  storedZip,
  typed,
  v2Array,
  type Dtype,
  type ZarrEntries,
} from '../test/ateraFixtures'
import { micrometers, type BBox } from './coords'
import {
  TRANSCRIPT_GENE_DENSITY_CHUNK_LIMIT,
  loadTranscriptZarrAggregates,
} from './transcriptZarr'

// Selected-gene density from density/gene (15.1-J), read from an in-memory
// transcripts.zarr.zip served with HTTP ranges.

const GENES = ['GENEA', 'GENEB', 'GENEC']

function bbox(minX: number, minY: number, maxX: number, maxY: number): BBox {
  return {
    minX: micrometers(minX),
    minY: micrometers(minY),
    maxX: micrometers(maxX),
    maxY: micrometers(maxY),
  }
}

// A 1D array split into chunks of `chunkSize` values.
function chunkedArray(
  entries: ZarrEntries,
  path: string,
  dtype: Dtype,
  values: readonly number[],
  chunkSize: number,
): void {
  entries.set(`${path}/.zarray`, json(v2Array(dtype, [values.length], [chunkSize])))

  for (let start = 0; start < values.length; start += chunkSize) {
    const chunk = values.slice(start, start + chunkSize)
    const padded = [...chunk, ...new Array<number>(chunkSize - chunk.length).fill(0)]
    entries.set(`${path}/${start / chunkSize}`, typed(dtype, padded))
  }
}

// One 10 µm cell per (row, column); per row, each gene's (column, count)
// pairs, stored gene by gene as Xenium does: indptr[gene * rows + row]. With
// `densityGene: false` the output predates density/gene.
function transcriptZarr(options: {
  readonly rows: readonly (readonly (readonly (readonly [number, number])[])[])[]
  readonly cols: number
  readonly chunkSize: number
  readonly densityGene?: boolean
}): Uint8Array {
  const entries: ZarrEntries = new Map()
  group(entries, '', { gene_names: GENES, codeword_gene_names: [], fov_names: [] })
  group(entries, 'grids', {
    grid_keys: [['0,0']],
    grid_number_objects: [[42]],
    grid_size: [250],
  })

  if (options.densityGene !== false) {
    group(entries, 'density', {})
    group(entries, 'density/gene', {
      rows: options.rows.length,
      cols: options.cols,
      grid_size: [10, 10],
      origin: { x: 0, y: 0 },
      gene_names: GENES,
    })
    const indptr = [0]
    const indices: number[] = []
    const data: number[] = []

    for (let gene = 0; gene < GENES.length; gene += 1) {
      for (const row of options.rows) {
        for (const [col, count] of row[gene] ?? []) {
          indices.push(col)
          data.push(count)
        }
        indptr.push(indices.length)
      }
    }

    array(entries, 'density/gene/indptr', '<u4', indptr)
    chunkedArray(entries, 'density/gene/indices', '<u4', indices, options.chunkSize)
    chunkedArray(entries, 'density/gene/data', '<u2', data, options.chunkSize)
  }

  return storedZip(entries)
}

// Rows 0–3 of a 4 × 4 grid:
//   row 0: GENEA (0, 2), (3, 1); GENEB (0, 3)
//   row 1: GENEB (1, 4); GENEC (2, 5)
//   row 2: GENEA (1, 6)
//   row 3: GENEA (3, 7); GENEB (3, 1)
const SMALL_ROWS = [
  [
    [
      [0, 2],
      [3, 1],
    ],
    [[0, 3]],
    [],
  ],
  [[], [[1, 4]], [[2, 5]]],
  [[[1, 6]], [], []],
  [[[3, 7]], [[3, 1]], []],
] as const

let urlCount = 0
const requestedRanges: string[] = []

// Serves the zip at a new URL, so the metadata cache starts empty.
function serve(zip: Uint8Array): string {
  urlCount += 1
  const url = `https://example.test/density-${urlCount}/transcripts.zarr.zip`
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) !== url) return new Response(null, { status: 404 })
      if (init?.method === 'HEAD') {
        return new Response(null, {
          headers: { 'content-length': String(zip.length) },
        })
      }
      const range = /bytes=(\d+)-(\d+)/.exec(
        new Headers(init?.headers).get('Range') ?? '',
      )
      if (range === null) return new Response(zip.slice())
      requestedRanges.push(range[0])
      const start = Number(range[1])
      const end = Number(range[2]) + 1
      return new Response(zip.slice(start, end), {
        status: 206,
        headers: { 'content-range': `bytes ${start}-${end - 1}/${zip.length}` },
      })
    }),
  )
  return url
}

afterEach(() => {
  vi.unstubAllGlobals()
  requestedRanges.length = 0
})

describe('selected-gene transcript density', () => {
  it('counts the selected genes per bin, with the total in view', async () => {
    const url = serve(transcriptZarr({ rows: SMALL_ROWS, cols: 4, chunkSize: 2 }))
    const result = await loadTranscriptZarrAggregates(url, bbox(0, 0, 39, 39), {
      featureNames: ['genea'],
      maxBins: 100,
    })

    expect(result.selectedFeatureNames).toEqual(['genea'])
    expect(result.visibleTranscriptCount).toBe(16)
    expect(result.scaleMax).toBe(7)
    expect(result.overBudget).toBeUndefined()
    expect(
      result.bins.map((bin) => [bin.binX, bin.binY, bin.count, bin.glyphType]),
    ).toEqual([
      [0, 0, 2, 'density'],
      [1, 2, 6, 'density'],
      [3, 0, 1, 'density'],
      [3, 3, 7, 'density'],
    ])
    // Colours follow the slide's largest square, not the view's.
    const corner = await loadTranscriptZarrAggregates(url, bbox(0, 0, 19, 19), {
      featureNames: ['GENEA'],
      maxBins: 100,
    })
    expect(corner.bins.map((bin) => bin.count)).toEqual([2])
    expect(corner.scaleMax).toBe(7)
    expect(result.bins[0]).toMatchObject({
      binSizeMicrometers: 10,
      position: { x: 5, y: 5 },
      selectedGeneCount: 2,
      topFeatures: [{ featureName: 'GENEA', count: 2 }],
    })
  })

  it('adds the genes together and keeps only the columns in view', async () => {
    const url = serve(transcriptZarr({ rows: SMALL_ROWS, cols: 4, chunkSize: 2 }))
    const result = await loadTranscriptZarrAggregates(url, bbox(0, 0, 19, 39), {
      featureNames: ['GENEA', 'GENEB'],
      maxBins: 100,
    })

    expect(result.visibleTranscriptCount).toBe(15)
    expect(result.bins.map((bin) => [bin.binX, bin.binY, bin.count])).toEqual([
      [0, 0, 5],
      [1, 1, 4],
      [1, 2, 6],
    ])
    expect(result.bins[0]?.topFeatures).toEqual([
      { featureName: 'GENEB', count: 3 },
      { featureName: 'GENEA', count: 2 },
    ])
  })

  it('uses the finest bins whose occupied squares fit the limit', async () => {
    const url = serve(transcriptZarr({ rows: SMALL_ROWS, cols: 4, chunkSize: 2 }))

    // 16 cells in the box, but GENEA occupies only 4 of them.
    const fine = await loadTranscriptZarrAggregates(url, bbox(0, 0, 39, 39), {
      featureNames: ['GENEA'],
      maxBins: 4,
    })
    expect(fine.level.gridSizeMicrometers).toBe(10)
    expect(fine.bins).toHaveLength(4)

    const merged = await loadTranscriptZarrAggregates(url, bbox(0, 0, 39, 39), {
      featureNames: ['GENEA'],
      maxBins: 3,
    })
    expect(merged.level.gridSizeMicrometers).toBe(40)
    expect(merged.bins.map((bin) => [bin.binX, bin.binY, bin.count])).toEqual([
      [0, 0, 16],
    ])
  })

  it('reads each gene once, then serves any view from memory', async () => {
    const url = serve(transcriptZarr({ rows: SMALL_ROWS, cols: 4, chunkSize: 2 }))
    await loadTranscriptZarrAggregates(url, bbox(0, 0, 19, 19), {
      featureNames: ['GENEA'],
      maxBins: 100,
    })
    const firstRequests = requestedRanges.length

    const whole = await loadTranscriptZarrAggregates(url, bbox(0, 0, 39, 39), {
      featureNames: ['GENEA'],
      maxBins: 100,
    })
    expect(requestedRanges).toHaveLength(firstRequests)
    expect(whole.visibleTranscriptCount).toBe(16)

    const withGeneB = await loadTranscriptZarrAggregates(url, bbox(0, 0, 39, 39), {
      featureNames: ['GENEA', 'GENEB'],
      maxBins: 100,
    })
    expect(requestedRanges.length).toBeGreaterThan(firstRequests)
    expect(withGeneB.visibleTranscriptCount).toBe(24)
  })

  it('reads nothing when the new genes span more chunks than the limit', async () => {
    // GENEA has one transcript in each row, one data chunk each; GENEB one.
    const rowCount = TRANSCRIPT_GENE_DENSITY_CHUNK_LIMIT + 8
    const rows = Array.from({ length: rowCount }, (_, row) => [
      [[0, 1] as const],
      row === 0 ? [[0, 2] as const] : [],
      [],
    ])
    const url = serve(transcriptZarr({ rows, cols: 1, chunkSize: 1 }))
    const view = bbox(0, 0, 9, 99)

    const tooMany = await loadTranscriptZarrAggregates(url, view, {
      featureNames: ['GENEA', 'GENEB'],
      maxBins: 1_000,
    })
    expect(tooMany.bins).toEqual([])
    expect(tooMany.overBudget).toEqual({
      chunkCount: rowCount + 1,
      chunkLimit: TRANSCRIPT_GENE_DENSITY_CHUNK_LIMIT,
    })

    const fits = await loadTranscriptZarrAggregates(url, view, {
      featureNames: ['GENEB'],
      maxBins: 1_000,
    })
    expect(fits.overBudget).toBeUndefined()
    expect(fits.visibleTranscriptCount).toBe(2)
  })

  it('counts all transcripts when the output has no density/gene', async () => {
    const url = serve(
      transcriptZarr({ rows: SMALL_ROWS, cols: 4, chunkSize: 2, densityGene: false }),
    )
    const result = await loadTranscriptZarrAggregates(url, bbox(0, 0, 39, 39), {
      featureNames: ['GENEA'],
      maxBins: 100,
    })

    expect(result.selectedFeatureNames).toEqual([])
    expect(result.bins.map((bin) => bin.count)).toEqual([42])
    expect(result.visibleTranscriptCount).toBeUndefined()
  })
})
