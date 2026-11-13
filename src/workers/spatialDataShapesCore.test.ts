import { afterEach, describe, expect, it, vi } from 'vitest'
import { spatialDataShapesHandler } from './spatialDataShapesCore'
import type { SpatialDataShapesWorkerResponse } from './spatialDataShapesMessages'
import { spatialDataShapesFixtureBytes } from '../test/spatialDataShapesFixtures'
import { rangeFetcher } from '../test/xeniumCellsFixtures'
import { IDENTITY_AFFINE } from '../datasets/spatialDataTransforms'

const URL = 'https://example.test/sample.zarr/shapes/cell_boundaries/shapes.parquet'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('spatialDataShapesHandler', () => {
  it('fetches a URL and transfers the shape columns', async () => {
    vi.stubGlobal(
      'fetch',
      rangeFetcher(spatialDataShapesFixtureBytes('cell_circles.parquet')),
    )
    const { responses, transfers, handle } = recordingHandler()

    handle({ type: 'read', source: { kind: 'url', url: URL }, affine: IDENTITY_AFFINE })
    const response = await answer(responses)

    expect(response.type).toBe('shapes')
    expect(response.type === 'shapes' && response.shapes.ids).toEqual(['7', '8', '9'])
    expect(transfers.at(-1)).toHaveLength(7)
  })

  it('reads a slices source through the main thread', async () => {
    const bytes = spatialDataShapesFixtureBytes('cell_boundaries.parquet')
    const { responses, handle } = recordingHandler((response) => {
      if (response.type === 'slice') {
        handle({
          type: 'slice',
          id: response.id,
          bytes: bytes.slice(response.start, response.end).buffer,
        })
      }
    })

    handle({
      type: 'read',
      source: { kind: 'slices', url: URL, byteLength: bytes.byteLength },
      affine: IDENTITY_AFFINE,
    })
    const response = await answer(responses)

    expect(response.type === 'shapes' && response.shapes.ids).toEqual([
      'aaaa-1',
      'aaab-1',
      'aaac-1',
      'aaad-1',
    ])
    expect(responses.filter((entry) => entry.type === 'slice').length).toBeGreaterThan(0)
  })

  it('reports a slice the main thread could not read', async () => {
    const { responses, handle } = recordingHandler((response) => {
      if (response.type === 'slice') {
        handle({ type: 'slice-error', id: response.id, error: 'zip entry unreadable' })
      }
    })

    handle({
      type: 'read',
      source: { kind: 'slices', url: URL, byteLength: 2048 },
      affine: IDENTITY_AFFINE,
    })
    const response = await answer(responses)

    expect(response).toEqual({
      type: 'error',
      error: 'zip entry unreadable',
      errorName: 'Error',
    })
  })
})

// The worker's answer, once it has sent one.
function answer(
  responses: readonly SpatialDataShapesWorkerResponse[],
): Promise<SpatialDataShapesWorkerResponse> {
  return vi.waitFor(() => {
    const response = responses.find((entry) => entry.type !== 'slice')

    if (response === undefined) {
      throw new Error('The worker has not answered yet.')
    }

    return response
  })
}

function recordingHandler(
  onResponse?: (response: SpatialDataShapesWorkerResponse) => void,
) {
  const responses: SpatialDataShapesWorkerResponse[] = []
  const transfers: Transferable[][] = []
  const handle = spatialDataShapesHandler((response, transfer) => {
    responses.push(response)
    transfers.push(transfer)
    onResponse?.(response)
  })

  return { responses, transfers, handle }
}
