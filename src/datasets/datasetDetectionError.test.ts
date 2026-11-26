import { describe, expect, it } from 'vitest'
import type { DatasetProbeResult } from './datasetFactory'
import {
  PROBE_HIDDEN_ERROR,
  PROBE_NOT_LISTED,
  classifyDatasetDetection,
  datasetDetectionError,
} from './datasetDetectionError'

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

  it('names the one file a chosen reader looked for when it is missing', () => {
    expect(
      datasetDetectionError([probe('experiment.spatial', { status: 404 })]).message,
    ).toBe('experiment.spatial was not found at this address.')
    expect(
      datasetDetectionError([probe('a', { status: 404 }), probe('b', { status: 403 })])
        .message,
    ).toBe('None of the 2 expected files were found at this address.')
  })

  it('says refused for other client errors, which are not a CORS block (15.5-B)', () => {
    const error = datasetDetectionError([
      probe('experiment.xenium', { status: 429 }),
      probe('cells.zarr.zip', { status: 400 }),
      probe('cells.parquet', { status: 429 }),
      probe('gene_panel.json', { error: 'Failed to fetch' }),
    ])

    expect(error.kind).toBe('refused')
    expect(error.message).toBe(
      'The host refused the requests for the expected files (HTTP 400 and 429).',
    )
    expect(classifyDatasetDetection([probe('a', { status: 405 })])).toBe('refused')
    expect(datasetDetectionError([probe('a', { status: 405 })]).message).toContain(
      '(HTTP 405)',
    )
  })

  it('names the cause from the probes a 404 did not answer (EXP-202)', () => {
    // A host that refuses HEAD with 405; the manifest GET is a plain 404.
    const refusedHead = datasetDetectionError([
      probe('explorer.json', { status: 404 }),
      probe('experiment.xenium', { status: 405 }),
      probe('experiment.spatial', { status: 405 }),
    ])

    expect(refusedHead.kind).toBe('refused')
    expect(refusedHead.message).toBe(
      'The host refused the requests for 2 of the 3 expected files (HTTP 405).',
    )
    expect(
      classifyDatasetDetection([
        probe('experiment.xenium', { status: 429 }),
        probe('zarr.json', { status: 404 }),
      ]),
    ).toBe('refused')
    expect(
      datasetDetectionError([
        probe('explorer.json', { status: 503 }),
        probe('experiment.xenium', { status: 404 }),
      ]).message,
    ).toBe('The host returned server errors for 1 of the 2 expected files (HTTP 503).')
    expect(
      datasetDetectionError([
        probe('experiment.xenium', { status: 404 }),
        probe('zarr.json', { error: 'Failed to fetch' }),
      ]).message,
    ).toMatch(/^The browser got no response for 1 of the 2 expected files, so they may/)
  })

  it('counts a fetch hidden by the host as a missing file (EXP-203)', () => {
    expect(
      classifyDatasetDetection([
        probe('experiment.xenium', { error: PROBE_NOT_LISTED }),
        probe('.zattrs', { error: PROBE_HIDDEN_ERROR }),
      ]),
    ).toBe('not-found')
  })

  it('says when the host did not answer in time (EXP-207)', () => {
    const timedOut = { error: 'Request timed out after 15,000 ms.' }
    const error = datasetDetectionError([
      probe('explorer.json', timedOut),
      probe('experiment.xenium', timedOut),
    ])

    expect(error.kind).toBe('timeout')
    expect(error.message).toBe(
      'The host did not answer the requests for the expected files within 15 s.',
    )
    expect(
      classifyDatasetDetection([
        probe('explorer.json', timedOut),
        probe('experiment.xenium', { error: 'Failed to fetch' }),
      ]),
    ).toBe('blocked')
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
