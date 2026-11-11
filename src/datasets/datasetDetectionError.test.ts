import { describe, expect, it } from 'vitest'
import type { DatasetProbeResult } from './datasetFactory'
import { classifyDatasetDetection, datasetDetectionError } from './datasetDetectionError'

function probe(path: string, result: Partial<DatasetProbeResult>): DatasetProbeResult {
  return { path, url: `https://example.test/${path}`, ok: false, ...result }
}

describe('dataset detection errors', () => {
  it('says not found for 404s, and for the 403s of buckets that deny listing', () => {
    expect(
      classifyDatasetDetection([
        probe('experiment.xenium', { status: 404 }),
        probe('cells.zarr.zip', { status: 404 }),
      ]),
    ).toBe('not-found')
    expect(classifyDatasetDetection([probe('experiment.xenium', { status: 403 })])).toBe(
      'not-found',
    )
    expect(
      classifyDatasetDetection([
        probe('experiment.xenium', { error: 'not in the folder listing' }),
      ]),
    ).toBe('not-found')
  })

  it('says blocked when no request got a response', () => {
    expect(
      classifyDatasetDetection([
        probe('experiment.xenium', { error: 'Failed to fetch' }),
        probe('cells.zarr.zip', { error: 'Failed to fetch' }),
      ]),
    ).toBe('blocked')
  })

  it('tells credentials and server failures apart', () => {
    expect(classifyDatasetDetection([probe('a', { status: 401 })])).toBe('access-denied')
    expect(
      classifyDatasetDetection([
        probe('a', { status: 502 }),
        probe('b', { status: 503 }),
      ]),
    ).toBe('server-error')
  })

  it('lists what was found when the layout is unknown', () => {
    const error = datasetDetectionError([
      probe('a.csv', { ok: true, status: 200 }),
      probe('b.json', { status: 404 }),
    ])

    expect(error.kind).toBe('unsupported')
    expect(error.name).toBe('DatasetDetectionError')
    expect(error.message).toBe('Found a.csv, but not a dataset layout the app reads.')
    expect(classifyDatasetDetection([])).toBe('unsupported')
  })
})
