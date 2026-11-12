import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compressors as parquetCompressors } from 'hyparquet-compressors'
import { DEFAULT_COALESCED_RANGE_CONCURRENCY } from '../data/coalescingAsyncBuffer'
import {
  VISIUM_HD_BARCODE_MAPPING_COLUMNS,
  VisiumHdBarcodeMappingsBudgetExceededError,
  parseVisiumHdBarcodeMappingRows,
  readVisiumHdBarcodeMappings,
  selectVisiumHdBarcodeMappingAssignments,
  visiumHdBarcodeMappingRowRanges,
} from './visiumHdBarcodeMappings'
import type { AsyncBuffer, FileMetaData } from 'hyparquet'
import type {
  VisiumHdBarcodeMappingsReadObjectsOptions,
  VisiumHdBarcodeMappingsSourceCache,
} from './visiumHdBarcodeMappings'

const fakeFile: AsyncBuffer = {
  byteLength: 8,
  slice: () => new ArrayBuffer(0),
}

describe('Visium HD barcode mappings', () => {
  it('projects root barcode_mappings.parquet columns through a budgeted read', async () => {
    const calls: VisiumHdBarcodeMappingsReadObjectsOptions[] = []
    const mappings = await readVisiumHdBarcodeMappings('https://example.test/visium', {
      file: fakeFile,
      maxRows: 10,
      readObjects: async (options) => {
        calls.push(options)
        return [
          {
            square_002um: 's_002um_000001_000002-1',
            square_008um: 's_008um_000000_000000-1',
            square_016um: 's_016um_000000_000000-1',
            cell_id: 'cell-1',
            in_nucleus: 1n,
            in_cell: true,
          },
        ]
      },
    })

    expect(calls).toEqual([
      {
        file: fakeFile,
        columns: VISIUM_HD_BARCODE_MAPPING_COLUMNS,
        rowFormat: 'object',
        rowEnd: 11,
        compressors: parquetCompressors,
      },
    ])
    expect(mappings).toEqual([
      {
        square002um: 's_002um_000001_000002-1',
        square008um: 's_008um_000000_000000-1',
        square016um: 's_016um_000000_000000-1',
        cellId: 'cell-1',
        inNucleus: true,
        inCell: true,
      },
    ])
  })

  it('rejects reads that return more rows than the configured budget', async () => {
    await expect(
      readVisiumHdBarcodeMappings('https://example.test/visium', {
        file: fakeFile,
        maxRows: 1,
        readObjects: async () => [
          mappingRow('s_002um_000001_000002-1'),
          mappingRow('s_002um_000003_000004-1'),
        ],
      }),
    ).rejects.toBeInstanceOf(VisiumHdBarcodeMappingsBudgetExceededError)
  })

  it('normalizes nullable cell ids and numeric cell flags', () => {
    expect(
      parseVisiumHdBarcodeMappingRows(
        [
          {
            ...mappingRow('s_002um_000001_000002-1'),
            cell_id: null,
            in_nucleus: 0,
            in_cell: 1,
          },
        ],
        { maxRows: 1 },
      ),
    ).toEqual([
      {
        square002um: 's_002um_000001_000002-1',
        square008um: 's_008um_000000_000000-1',
        square016um: 's_016um_000000_000000-1',
        cellId: null,
        inNucleus: false,
        inCell: true,
      },
    ])
  })

  it('rejects barcode columns that do not match the expected tier', () => {
    expect(() =>
      parseVisiumHdBarcodeMappingRows(
        [
          {
            ...mappingRow('s_008um_000001_000002-1'),
          },
        ],
        { maxRows: 1 },
      ),
    ).toThrow('Expected barcode_mappings.parquet square_002um')
  })

  it('selects cell assignments for a requested binned tier', () => {
    const mappings = parseVisiumHdBarcodeMappingRows(
      [
        {
          square_002um: 's_002um_000001_000002-1',
          square_008um: 's_008um_000000_000000-1',
          square_016um: 's_016um_000000_000000-1',
          cell_id: 'cell-a',
          in_nucleus: true,
          in_cell: true,
        },
        {
          square_002um: 's_002um_000003_000004-1',
          square_008um: 's_008um_000000_000001-1',
          square_016um: 's_016um_000000_000000-1',
          cell_id: null,
          in_nucleus: false,
          in_cell: false,
        },
      ],
      { maxRows: 2 },
    )

    expect(
      selectVisiumHdBarcodeMappingAssignments(mappings, 16, ['s_016um_000000_000000-1']),
    ).toEqual([
      {
        binId: 's_016um_000000_000000-1',
        square002um: 's_002um_000001_000002-1',
        cellId: 'cell-a',
        inNucleus: true,
        inCell: true,
      },
      {
        binId: 's_016um_000000_000000-1',
        square002um: 's_002um_000003_000004-1',
        cellId: null,
        inNucleus: false,
        inCell: false,
      },
    ])
  })
})

// src/test/fixtures/visium-hd/barcode_mappings.parquet (see make_fixtures.py
// there): 48 x 40 2 µm bins, one 2 µm row of 40 bins per row group, so 48 row
// groups of 6 column chunks.
const FIXTURE_BASE_URL = 'https://example.test/visium'
const FIXTURE_BYTES = new Uint8Array(
  readFileSync(
    join(process.cwd(), 'src/test/fixtures/visium-hd/barcode_mappings.parquet'),
  ),
)
const FIXTURE_ROWS = 48 * 40
const FIXTURE_COLUMN_CHUNKS = 48 * 6

// Serves the fixture with HEAD and Range, recording each request and how many
// are in flight. A response arrives on the next macrotask.
function fixtureFetcher() {
  const requests: string[] = []
  let inFlight = 0
  let peak = 0
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const range = request.headers.get('Range')
    requests.push(request.method === 'HEAD' ? 'HEAD' : String(range))
    inFlight += 1
    peak = Math.max(peak, inFlight)

    try {
      await new Promise((resolve) => setTimeout(resolve, 0))
      request.signal.throwIfAborted()

      if (new URL(request.url).pathname !== '/visium/barcode_mappings.parquet') {
        return new Response(null, { status: 404 })
      }

      if (request.method === 'HEAD') {
        return new Response(null, {
          headers: { 'Content-Length': String(FIXTURE_BYTES.byteLength) },
        })
      }

      const match = /^bytes=(\d+)-(\d+)$/.exec(String(range))

      if (match === null) {
        return new Response(FIXTURE_BYTES.slice(), { status: 200 })
      }

      const start = Number(match[1])
      const end = Math.min(Number(match[2]), FIXTURE_BYTES.byteLength - 1)
      return new Response(FIXTURE_BYTES.slice(start, end + 1), {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${FIXTURE_BYTES.byteLength}`,
        },
      })
    } finally {
      inFlight -= 1
    }
  }) as typeof fetch

  return { fetcher, requests, peak: () => peak }
}

function rangeLength(request: string): number {
  const match = /^bytes=(\d+)-(\d+)$/.exec(request)
  return match === null ? 0 : Number(match[2]) - Number(match[1]) + 1
}

describe('Visium HD barcode mappings over HTTP', () => {
  it('keeps column chunk reads under the concurrency limit', async () => {
    const recorded = fixtureFetcher()

    // With 1-byte ranges nothing merges, so each of the 288 column chunks is
    // a request of its own, as before coalescing; hyparquet asks for them all
    // at once.
    const mappings = await readVisiumHdBarcodeMappings(FIXTURE_BASE_URL, {
      fetcher: recorded.fetcher,
      byteRangeCache: null,
      rangeRequests: { maxRangeBytes: 1 },
    })

    expect(mappings).toHaveLength(FIXTURE_ROWS)
    // HEAD, the footer (the whole small file), then each column chunk.
    expect(recorded.requests).toHaveLength(2 + FIXTURE_COLUMN_CHUNKS)
    expect(recorded.peak()).toBe(DEFAULT_COALESCED_RANGE_CONCURRENCY)
  })

  it('reads all column chunks in one request when they fit in a range', async () => {
    const recorded = fixtureFetcher()

    const mappings = await readVisiumHdBarcodeMappings(FIXTURE_BASE_URL, {
      fetcher: recorded.fetcher,
      byteRangeCache: null,
    })

    expect(mappings).toHaveLength(FIXTURE_ROWS)
    expect(mappings[0]).toEqual({
      square002um: 's_002um_00000_00000-1',
      square008um: 's_008um_00000_00000-1',
      square016um: 's_016um_00000_00000-1',
      cellId: 'cellid_000000001-1',
      inNucleus: false,
      inCell: true,
    })
    expect(recorded.requests).toHaveLength(3)
    expect(recorded.peak()).toBe(1)
  })

  it('reads only the row groups that can hold the requested bins', async () => {
    const all = await readVisiumHdBarcodeMappings(FIXTURE_BASE_URL, {
      fetcher: fixtureFetcher().fetcher,
      byteRangeCache: null,
    })
    const sourceCache: VisiumHdBarcodeMappingsSourceCache = new Map()
    const first = fixtureFetcher()

    // 16 µm bin (2, 3) covers 2 µm rows 16-23 and columns 24-31.
    const bin16 = await readVisiumHdBarcodeMappings(FIXTURE_BASE_URL, {
      fetcher: first.fetcher,
      byteRangeCache: null,
      sourceCache,
      bins: { binSizeMicrometers: 16, binIds: ['s_016um_00002_00003-1'] },
    })

    expect(bin16).toHaveLength(64)
    expect(bin16).toEqual(all.filter((m) => m.square016um === 's_016um_00002_00003-1'))
    // HEAD and footer, then 8 of the 48 row groups in one request.
    expect(first.requests).toHaveLength(3)
    expect(rangeLength(first.requests[2] as string)).toBeLessThan(
      FIXTURE_BYTES.byteLength / 4,
    )

    // Later reads reuse the size and footer. Row groups 0 and 47 are under
    // 256 KB apart in this small file, so they share one request.
    const second = fixtureFetcher()
    const bins2 = await readVisiumHdBarcodeMappings(FIXTURE_BASE_URL, {
      fetcher: second.fetcher,
      byteRangeCache: null,
      sourceCache,
      bins: {
        binSizeMicrometers: 2,
        binIds: [
          's_002um_00047_00039-1',
          's_002um_00000_00000-1',
          's_002um_00099_00000-1',
        ],
      },
    })

    expect(bins2.map((m) => m.square002um)).toEqual([
      's_002um_00000_00000-1',
      's_002um_00047_00039-1',
    ])
    expect(second.requests).toEqual([expect.stringMatching(/^bytes=\d+-\d+$/)])
  })

  it('shares one footer read between bin reads that start together', async () => {
    const sourceCache: VisiumHdBarcodeMappingsSourceCache = new Map()
    const recorded = fixtureFetcher()
    const read = (binId: string) =>
      readVisiumHdBarcodeMappings(FIXTURE_BASE_URL, {
        fetcher: recorded.fetcher,
        byteRangeCache: null,
        sourceCache,
        bins: { binSizeMicrometers: 8, binIds: [binId] },
      })

    const [a, b] = await Promise.all([
      read('s_008um_00000_00000-1'),
      read('s_008um_00011_00009-1'),
    ])

    expect(a).toHaveLength(16)
    expect(b).toHaveLength(16)
    expect(recorded.requests.filter((request) => request === 'HEAD')).toHaveLength(1)
  })

  it('rejects bin reads whose row groups exceed the row budget', async () => {
    await expect(
      readVisiumHdBarcodeMappings(FIXTURE_BASE_URL, {
        fetcher: fixtureFetcher().fetcher,
        byteRangeCache: null,
        maxRows: 100,
        bins: { binSizeMicrometers: 16, binIds: ['s_016um_00002_00003-1'] },
      }),
    ).rejects.toMatchObject({
      name: 'VisiumHdBarcodeMappingsBudgetExceededError',
      observedRows: 320,
      maxRows: 100,
    })
  })
})

describe('visiumHdBarcodeMappingRowRanges', () => {
  const metadata = {
    row_groups: [
      rowGroup(10, 's_016um_00000_00000-1', 's_016um_00000_00009-1'),
      rowGroup(10, 's_016um_00000_00000-1', 's_016um_00001_00009-1'),
      rowGroup(10, 's_016um_00001_00000-1', 's_016um_00001_00009-1'),
      rowGroup(0, 's_016um_00001_00000-1', 's_016um_00001_00009-1'),
      rowGroup(10, 's_016um_00002_00000-1', 's_016um_00002_00009-1'),
      rowGroup(10),
      rowGroup(10, 's_016um_00003_00000-1', 's_016um_00003_00009-1'),
    ],
  } as unknown as FileMetaData

  it('keeps row groups whose statistics hold a bin, or that have none', () => {
    expect(
      visiumHdBarcodeMappingRowRanges(metadata, 'square_016um', [
        's_016um_00001_00004-1',
      ]),
    ).toEqual([
      { rowStart: 10, rowEnd: 30 },
      { rowStart: 40, rowEnd: 50 },
    ])
  })

  it('accepts bins in any order and repeated', () => {
    expect(
      visiumHdBarcodeMappingRowRanges(metadata, 'square_016um', [
        's_016um_00003_00001-1',
        's_016um_00000_00005-1',
        's_016um_00003_00001-1',
        's_016um_00009_00000-1',
      ]),
    ).toEqual([
      { rowStart: 0, rowEnd: 20 },
      { rowStart: 40, rowEnd: 60 },
    ])
  })

  it('splits neighbouring row groups at the rows-per-range limit', () => {
    expect(
      visiumHdBarcodeMappingRowRanges(
        metadata,
        'square_016um',
        ['s_016um_00000_00005-1', 's_016um_00001_00005-1'],
        15,
      ),
    ).toEqual([
      { rowStart: 0, rowEnd: 10 },
      { rowStart: 10, rowEnd: 20 },
      { rowStart: 20, rowEnd: 30 },
      { rowStart: 40, rowEnd: 50 },
    ])
  })

  it('keeps every row group when the column has no statistics', () => {
    expect(
      visiumHdBarcodeMappingRowRanges(metadata, 'square_008um', [
        's_008um_00000_00000-1',
      ]),
    ).toEqual([{ rowStart: 0, rowEnd: 60 }])
  })
})

function rowGroup(rows: number, min?: string, max?: string) {
  return {
    num_rows: BigInt(rows),
    columns: [
      {
        meta_data: {
          path_in_schema: ['square_016um'],
          ...(min === undefined
            ? {}
            : { statistics: { min_value: min, max_value: max } }),
        },
      },
      { meta_data: { path_in_schema: ['square_008um'] } },
    ],
  }
}

function mappingRow(square002um: string): Record<string, unknown> {
  return {
    square_002um: square002um,
    square_008um: 's_008um_000000_000000-1',
    square_016um: 's_016um_000000_000000-1',
    cell_id: 'cell-1',
    in_nucleus: false,
    in_cell: true,
  }
}
