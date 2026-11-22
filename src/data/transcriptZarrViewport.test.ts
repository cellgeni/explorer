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

// Two transcripts in tile 0,0; the file marks the second invalid.
function transcriptZarrWithValid(): Uint8Array {
  const entries: ZarrEntries = new Map()
  group(entries, '', { gene_names: ['GENEA'], codeword_gene_names: [], fov_names: [] })
  group(entries, 'grids', {
    grid_keys: [['0,0']],
    grid_number_objects: [[2]],
    grid_size: [GRID_SIZE],
  })
  group(entries, 'grids/0', {})
  group(entries, 'grids/0/0,0', {})
  const tile = (name: string, dtype: '<f4' | '<u2' | '<u4' | '|u1', rows: number[][]) =>
    matrixArray(entries, `grids/0/0,0/${name}`, dtype, rows, { chunkRows: 2 })
  tile('location', '<f4', [
    [10, 10, 1],
    [20, 20, 1],
  ])
  tile('gene_identity', '<u2', [[0], [0]])
  tile('id', '<u4', [
    [1, 0],
    [2, 0],
  ])
  tile('quality_score', '<f4', [[40], [40]])
  tile('valid', '|u1', [[1], [0]])

  return storedZip(entries)
}

let urlCount = 0
// Zip entries whose reads fail, as on a dropped connection.
const failingEntries: string[] = []

// Whether a range reads an entry: its local header (30 bytes, then the name)
// or the data that starts after the name. Reads that reach the end of the
// file look for the central directory, and always work.
function coversEntry(zip: Uint8Array, start: number, end: number, name: string): boolean {
  const nameOffset = Buffer.from(zip.buffer, zip.byteOffset, zip.length).indexOf(name)
  const dataOffset = nameOffset + name.length
  return (
    nameOffset >= 0 && end < zip.length && start <= dataOffset && nameOffset - 30 < end
  )
}

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
      if (failingEntries.some((name) => coversEntry(zip, start, end, name))) {
        throw new TypeError('Failed to fetch')
      }
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
  failingEntries.length = 0
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

  it('fails, rather than show invalid transcripts, when valid cannot be read', async () => {
    const url = serve(transcriptZarrWithValid())
    const view = {
      minX: micrometers(0),
      minY: micrometers(0),
      maxX: micrometers(GRID_SIZE - 1),
      maxY: micrometers(GRID_SIZE - 1),
    }
    const ids = async () =>
      (await loadTranscriptZarrViewport(url, view, { minQv: 20 })).points.map(
        (point) => point.transcriptId,
      )

    await expect(ids()).resolves.toEqual(['1'])
    failingEntries.push('grids/0/0,0/valid/.zarray')
    await expect(ids()).rejects.toThrow()
    failingEntries.length = 0
    await expect(ids()).resolves.toEqual(['1'])
  })
})
