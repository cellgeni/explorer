import { afterEach, describe, expect, it, vi } from 'vitest'
import { group, storedZip, type ZarrEntries } from '../test/ateraFixtures'
import { micrometers, type BBox } from './coords'
import {
  estimateTranscriptZarrViewportCount,
  loadTranscriptZarrGridCounts,
  transcriptZarrExactGridLevel,
  type TranscriptGridLevelMetadata,
} from './transcriptZarr'

// The visible transcript estimate from the level-0 grid counts of
// transcripts.zarr.zip (grids attrs grid_keys and grid_number_objects).

const LEVEL_0: TranscriptGridLevelMetadata = {
  level: 0,
  tileSizeMicrometers: 250,
  gridKeys: ['0,0', '1,0', '0,1', '1,1'],
  transcriptCounts: [1_000, 2_000, 3_000, 4_000],
}

function bbox(minX: number, minY: number, maxX: number, maxY: number): BBox {
  return {
    minX: micrometers(minX),
    minY: micrometers(minY),
    maxX: micrometers(maxX),
    maxY: micrometers(maxY),
  }
}

describe('transcript estimate from transcripts.zarr.zip grid counts', () => {
  it('counts a whole tile inside the view', () => {
    expect(estimateTranscriptZarrViewportCount(LEVEL_0, bbox(0, 0, 250, 250))).toBe(1_000)
    expect(estimateTranscriptZarrViewportCount(LEVEL_0, bbox(-100, -100, 600, 600))).toBe(
      10_000,
    )
  })

  it('weights a partial tile by the share of its area in view', () => {
    // A quarter of tile 0,0.
    expect(estimateTranscriptZarrViewportCount(LEVEL_0, bbox(0, 0, 125, 125))).toBe(250)
    // Half of 0,0 and half of 1,0; tiles 0,1 and 1,1 only touch the edge.
    expect(estimateTranscriptZarrViewportCount(LEVEL_0, bbox(125, 0, 375, 250))).toBe(
      1_500,
    )
  })

  it('counts nothing in a view with no tiles', () => {
    expect(estimateTranscriptZarrViewportCount(LEVEL_0, bbox(600, 600, 900, 900))).toBe(0)
    expect(estimateTranscriptZarrViewportCount(LEVEL_0, bbox(100, 100, 100, 200))).toBe(0)
  })

  it('uses only level 0, since coarser levels hold a sample of the transcripts', () => {
    const level1: TranscriptGridLevelMetadata = {
      level: 1,
      tileSizeMicrometers: 500,
      gridKeys: ['0,0'],
      transcriptCounts: [7_600],
    }

    expect(transcriptZarrExactGridLevel([level1, LEVEL_0])).toBe(LEVEL_0)
    expect(transcriptZarrExactGridLevel([level1])).toBeNull()
  })
})

describe('loadTranscriptZarrGridCounts', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads the level-0 counts from the grids attributes', async () => {
    const url = serve(
      transcriptZarr({
        grid_keys: [['0,0', '1,0'], ['0,0']],
        grid_number_objects: [[40, 60], [76]],
        grid_size: [250],
      }),
    )

    await expect(loadTranscriptZarrGridCounts(url)).resolves.toEqual({
      level: 0,
      tileSizeMicrometers: 250,
      gridKeys: ['0,0', '1,0'],
      transcriptCounts: [40, 60],
    })
  })

  it('returns null when level 0 has no counts', async () => {
    const url = serve(
      transcriptZarr({
        grid_keys: [['0,0'], ['0,0']],
        grid_number_objects: [[], [76]],
        grid_size: [250],
      }),
    )

    await expect(loadTranscriptZarrGridCounts(url)).resolves.toBeNull()
  })
})

function transcriptZarr(gridsAttrs: Record<string, unknown>): Uint8Array {
  const entries: ZarrEntries = new Map()
  group(entries, '', { gene_names: ['GENEA'], codeword_gene_names: [], fov_names: [] })
  group(entries, 'grids', gridsAttrs)

  return storedZip(entries)
}

let urlCount = 0

// Serves the zip at a new URL, so the metadata cache starts empty.
function serve(zip: Uint8Array): string {
  urlCount += 1
  const url = `https://example.test/estimate-${urlCount}/transcripts.zarr.zip`
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
