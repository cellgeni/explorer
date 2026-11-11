import { afterEach, describe, expect, it, vi } from 'vitest'
import { group, matrixArray, storedZip, type ZarrEntries } from '../test/ateraFixtures'
import { micrometers } from './coords'
import { loadTranscriptZarrViewport } from './transcriptZarr'

// Exact points from level-0 tiles of an in-memory transcripts.zarr.zip,
// served with HTTP ranges.

const GRID_SIZE = 250

// One transcript of GENEA in each tile, 10 µm into it.
function transcriptZarr(tileKeys: readonly string[]): Uint8Array {
  const entries: ZarrEntries = new Map()
  group(entries, '', { gene_names: ['GENEA'], codeword_gene_names: [], fov_names: [] })
  group(entries, 'grids', {
    grid_keys: [tileKeys],
    grid_number_objects: [tileKeys.map(() => 1)],
    grid_size: [GRID_SIZE],
  })
  group(entries, 'grids/0', {})

  for (const [index, key] of tileKeys.entries()) {
    const [tileX = 0, tileY = 0] = key.split(',').map(Number)
    const path = `grids/0/${key}`
    group(entries, path, {})
    matrixArray(
      entries,
      `${path}/location`,
      '<f4',
      [[tileX * GRID_SIZE + 10, tileY * GRID_SIZE + 10, 1]],
      { chunkRows: 1 },
    )
    matrixArray(entries, `${path}/gene_identity`, '<u2', [[0]], { chunkRows: 1 })
    matrixArray(entries, `${path}/id`, '<u4', [[index + 1, 0]], { chunkRows: 1 })
    matrixArray(entries, `${path}/quality_score`, '<f4', [[40]], { chunkRows: 1 })
  }

  return storedZip(entries)
}

let urlCount = 0

// Serves the zip at a new URL, so the metadata cache starts empty.
function serve(zip: Uint8Array): string {
  urlCount += 1
  const url = `https://example.test/viewport-${urlCount}/transcripts.zarr.zip`
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
})

describe('exact transcripts from transcripts.zarr.zip', () => {
  it('reports the share of tiles read after each tile (15.3-D)', async () => {
    const url = serve(transcriptZarr(['0,0', '1,0', '2,0', '3,0']))
    const onProgress = vi.fn<(fraction: number) => void>()

    const result = await loadTranscriptZarrViewport(
      url,
      {
        minX: micrometers(0),
        minY: micrometers(0),
        maxX: micrometers(GRID_SIZE * 4 - 1),
        maxY: micrometers(GRID_SIZE - 1),
      },
      { minQv: 20, onProgress },
    )

    expect(result.points.map((point) => point.featureName)).toEqual([
      'GENEA',
      'GENEA',
      'GENEA',
      'GENEA',
    ])
    expect(onProgress.mock.calls.map(([fraction]) => fraction)).toEqual([
      0.25, 0.5, 0.75, 1,
    ])
  })
})
