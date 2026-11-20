// Area AD, review 2026-11-19: cell/gene axes, IDs and value semantics of the
// AnnData reader across its backends. Expected values come from
// fixtures/AD/expected.json (numpy, written by make_fixtures.py), never from
// the code under review.
//
//   npx vitest run --config docs/review/2026-11-19/evidence/repro/vitest.repro.config.ts \
//     docs/review/2026-11-19/evidence/repro/AD/axes.repro.ts
//
// Each `it` asserts what the reviewed commit actually does; the comment above
// it says which contract that breaks. Observations are also written to
// evidence/AD/axes-observations.json.
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { AnnDataH5adDataset } from '../../../../../../src/datasets/h5adDataset'
import { createInProcessH5Worker } from '../../../../../../src/data/h5WorkerFile'
import { micrometers } from '../../../../../../src/data/coords'

const ROOT = process.cwd()
const FIXTURES = join(ROOT, 'docs/review/2026-11-19/evidence/fixtures/AD')
const OUT = join(ROOT, 'docs/review/2026-11-19/evidence/AD')
const expected = JSON.parse(readFileSync(join(FIXTURES, 'expected.json'), 'utf8')) as {
  X: (number | null)[][]
  coordinates: number[][]
  sumGNeg: number[]
  column1: number[]
  column2: number[]
}
const observations: Record<string, unknown> = {}
const WHOLE = {
  minX: micrometers(-1e6),
  maxX: micrometers(1e6),
  minY: micrometers(-1e6),
  maxY: micrometers(1e6),
}

type Kind = 'csr' | 'csc' | 'dense'
type Path = 'whole' | 'range' | 'range-lazy' | 'zarr'

function fixtureBytes(kind: Kind): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, `axes-${kind}.h5ad`)))
}

// A fetcher that serves the fixture whole (custom fetcher: whole download on
// this thread, as tests do).
function wholeFetcher(bytes: Uint8Array): typeof fetch {
  return (async (_input: RequestInfo | URL, init?: RequestInit) =>
    init?.method === 'HEAD'
      ? new Response(null, { headers: { 'content-length': String(bytes.byteLength) } })
      : new Response(bytes.slice())) as typeof fetch
}

// Global fetch answering Range like a static host, and in-process H5 workers
// reading the bytes by range as the real worker does.
function rangeHost(bytes: Uint8Array) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const range = new Headers(init?.headers).get('range')
      if ((init?.method ?? 'GET') === 'HEAD') return new Response(null)
      const match = /^bytes=(\d+)-(\d+)$/.exec(range ?? '')
      if (match === null) return new Response(bytes.slice())
      const start = Number(match[1])
      const end = Math.min(Number(match[2]) + 1, bytes.byteLength)
      return new Response(bytes.slice(start, end), {
        status: 206,
        headers: { 'content-range': `bytes ${start}-${end - 1}/${bytes.byteLength}` },
      })
    }),
  )
  return () =>
    createInProcessH5Worker({
      createRangeRead: () => (start: number, end: number) => bytes.slice(start, end),
    })
}

// Serves the AnnData Zarr fixture folder at https://example.test/axes-<kind>.zarr.
function zarrFolderFetcher(): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const url = new URL(request.url)
    const file = join(FIXTURES, decodeURIComponent(url.pathname))
    if (!existsSync(file) || !statSync(file).isFile()) {
      return new Response(null, { status: 404 })
    }
    const bytes = new Uint8Array(readFileSync(file))
    if (request.method === 'HEAD') {
      return new Response(null, {
        headers: { 'content-length': String(bytes.byteLength) },
      })
    }
    const range = request.headers.get('range')
    const suffix = /^bytes=-(\d+)$/.exec(range ?? '')
    const match = /^bytes=(\d+)-(\d+)$/.exec(range ?? '')
    if (suffix !== null) {
      const start = Math.max(0, bytes.byteLength - Number(suffix[1]))
      return new Response(bytes.slice(start), { status: 206 })
    }
    if (match !== null) {
      return new Response(bytes.slice(Number(match[1]), Number(match[2]) + 1), {
        status: 206,
      })
    }
    return new Response(bytes)
  }) as typeof fetch
}

function open(kind: Kind, path: Path): AnnDataH5adDataset {
  const bytes = fixtureBytes(kind)
  switch (path) {
    case 'whole':
      return new AnnDataH5adDataset({
        url: `https://example.test/axes-${kind}.h5ad`,
        fetcher: wholeFetcher(bytes),
      })
    case 'range':
    case 'range-lazy':
      return new AnnDataH5adDataset({
        url: `https://example.test/axes-${kind}.h5ad`,
        h5WorkerFactory: rangeHost(bytes),
        ...(path === 'range-lazy' ? { rangeMatrixMaxBytes: 0 } : {}),
      })
    case 'zarr':
      return new AnnDataH5adDataset({
        url: `https://example.test/axes-${kind}.zarr`,
        fetcher: zarrFolderFetcher(),
        zarr: true,
      })
  }
}

async function observe(kind: Kind, path: Path) {
  const dataset = open(kind, path)
  const cellIds = await dataset.cellIds()
  const genes = await dataset.genePanel()
  const overview = await dataset.overview()
  const single = await dataset.geneExpression(WHOLE, ['G-2'])
  const signature = await dataset.geneExpression(WHOLE, ['G', 'Neg'])
  const nan = await dataset.geneExpression(WHOLE, ['Nan'])
  const values = await dataset.geneValues(['G-2'])
  let profile: unknown
  try {
    const matrix = await dataset.matrix(['c0', 'c3'])
    profile = Object.fromEntries(matrix.cells)
  } catch (error) {
    profile = { error: (error as Error).name }
  }
  const tracks = await dataset.metadataTracks()
  const bigId = await dataset.numericObsColumn('big_id')
  dataset.dispose()

  return {
    cellIds,
    genes,
    overview: overview.map((point) => [point.cellId, point.position.x, point.position.y]),
    singleG2: single.elements.map((element) => [element.id, element.count]),
    signatureGNeg: signature.elements.map((element) => [element.id, element.count]),
    nanElements: nan.elements.map((element) => [element.id, element.count]),
    nanMaxCount: nan.maxCount,
    geneValuesG2:
      'error' in values[0]!
        ? values[0]!.error
        : [...values[0]!.rows].map((row, index) => [row, values[0]!.values[index]]),
    profile,
    tracks: tracks.map((track) => [track.id, track.min, track.max]),
    bigId,
  }
}

const PATHS: readonly (readonly [Kind, Path])[] = [
  ['csr', 'whole'],
  ['csc', 'whole'],
  ['dense', 'whole'],
  ['csr', 'range'],
  ['csr', 'range-lazy'],
  ['csc', 'range-lazy'],
  ['dense', 'range-lazy'],
  ['csr', 'zarr'],
  ['csc', 'zarr'],
  ['dense', 'zarr'],
]

afterEach(() => {
  vi.unstubAllGlobals()
})

afterAll(() => {
  writeFileSync(
    join(OUT, 'axes-observations.json'),
    `${JSON.stringify(observations, null, 1)}\n`,
  )
})

describe.each(PATHS)('AnnData %s read %s', (kind, path) => {
  it('observes the axes, IDs and values', async () => {
    const seen = await observe(kind, path)
    observations[`${kind}/${path}`] = seen

    // Coordinates: obsm/spatial used once, unscaled, x/y not swapped.
    expect(seen.overview.map(([, x, y]) => [x, y])).toEqual(expected.coordinates)

    // AD-01: the documented rule "duplicates get -2, -3 suffixes" yields a
    // duplicate ID when a stored name already ends in -2. Two rows share the
    // ID c0-2, and two genes the name G-2.
    expect(seen.cellIds).toEqual(['c0', 'c0-2', 'c0-2', 'c3', 'obs-4', 'c5'])
    expect(seen.genes).toEqual(['G', 'G-2', 'G-2', 'Neg', 'Empty', 'Nan'])

    // AD-01: the map and the Plots panel read different columns for the
    // same gene name: the map takes the last column named G-2 (column 2),
    // Plots the first (column 1). And row 1 (stored name c0, column-2 value
    // 20) is coloured with row 2's value 30: both rows have the ID c0-2 and
    // the ID-to-row map keeps the last.
    expect(expected.column2).toEqual([10, 20, 30, 40, 0, 50])
    expect(seen.singleG2.map(([, count]) => count)).toEqual([10, 30, 30, 40, 0, 50])
    expect(seen.geneValuesG2).toEqual(
      expected.column1.flatMap((value, row) => (value === 0 ? [] : [[row, value]])),
    )

    // AD-02: a multi-gene read drops negative stored values, so a signature
    // sums only the positive part. numpy: G + Neg = [-1, 2, 3, -1, 0, 7].
    expect(seen.signatureGNeg.map(([, count]) => count)).not.toEqual(expected.sumGNeg)
    // Rows 0 and 3 lose their negative Neg (1 not -1, 0 not -1); row 1 again
    // shows row 2's value (AD-01).
    expect(seen.signatureGNeg.map(([, count]) => count)).toEqual([1, 3, 3, 0, 0, 7])

    // AD-02: and the selected-cell (all-gene) profile leaves Neg out of c0
    // and c3, whose stored values are -2 and -1.
    if (!(kind === 'csc' && (path === 'range-lazy' || path === 'zarr'))) {
      const profile = seen.profile as Record<string, { geneNames: string[] }>
      expect(profile.c0?.geneNames).not.toContain('Neg')
      expect(profile.c3?.geneNames).not.toContain('Neg')
    }

    // AD-03: c3's NaN in gene Nan is kept as a NaN count (not 0, not left
    // out), and Math.max then makes the batch's maxCount NaN.
    expect(seen.nanElements.find(([id]) => id === 'c3')?.[1]).toBeNaN()
    expect(seen.nanMaxCount).toBeNaN()
  })
})

// AD-01: with colliding gene names, the all-gene profile of one cell differs
// by backend. numpy: c0 = {G: 1, G-2(col 2): 10, Neg: -2};
// c3 = {G-2(col 1): 6, G-2(col 2): 40, Neg: -1, Nan: NaN}.
describe('selected-cell profile with colliding gene names, by backend', () => {
  it('reports what each backend returned', () => {
    const profiles = Object.fromEntries(
      Object.entries(observations).map(([key, value]) => [
        key,
        (value as { profile: unknown }).profile,
      ]),
    )
    writeFileSync(
      join(OUT, 'axes-profiles.json'),
      `${JSON.stringify(profiles, null, 1)}\n`,
    )
    const c3 = (key: string) =>
      (profiles[key] as Record<string, { geneNames: string[]; counts: number[] }>).c3
    // CSR keeps both stored columns (two genes named G-2: 6 and 40)...
    expect(c3('csr/whole')?.counts.slice(0, 2)).toEqual([6, 40])
    // ...dense and in-memory CSC report column 2 twice (40, 40) and lose 6...
    expect(c3('dense/whole')?.counts.slice(0, 2)).toEqual([40, 40])
    expect(c3('csc/whole')?.counts.slice(0, 2)).toEqual([40, 40])
    // ...and a dense Zarr /X reports it once.
    expect(c3('dense/zarr')?.geneNames.filter((name) => name === 'G-2')).toHaveLength(1)
  })
})
