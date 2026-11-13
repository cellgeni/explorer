import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  rangeFetcher,
  xeniumCellsFixtureBytes,
  XENIUM_CELLS_FIXTURE_ROWS,
} from '../test/xeniumCellsFixtures'
import {
  cellsOverviewTransferables,
  handleCellsOverviewRequest,
} from './cellsOverviewCore'
import type { CellsOverviewWorkerResponse } from './cellsOverviewMessages'

const CELLS_URL = 'https://example.test/xenium/cells.parquet'

async function respondTo(
  request: Parameters<typeof handleCellsOverviewRequest>[0],
): Promise<{ response: CellsOverviewWorkerResponse; transfer: Transferable[] }> {
  let answer: { response: CellsOverviewWorkerResponse; transfer: Transferable[] } | null =
    null

  await handleCellsOverviewRequest(request, (response, transfer) => {
    answer = { response, transfer }
  })

  if (answer === null) {
    throw new Error('The handler did not respond.')
  }

  return answer
}

describe('handleCellsOverviewRequest', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches the file and transfers the decoded columns', async () => {
    vi.stubGlobal('fetch', rangeFetcher(xeniumCellsFixtureBytes('cells.parquet')))

    const { response, transfer } = await respondTo({
      url: CELLS_URL,
      includeCellIds: true,
    })

    if (!response.ok) {
      throw new Error(response.error)
    }

    const { columns } = response
    expect(columns.length).toBe(XENIUM_CELLS_FIXTURE_ROWS)
    expect(columns.cellIds?.[0]).toBe('bcdeklmn-1')
    expect(columns.segmentationMethods).toHaveLength(3)
    expect(transfer).toEqual(cellsOverviewTransferables(columns))
    expect(transfer).toHaveLength(6)
    expect(transfer).toContain(columns.x.buffer)
  })

  it('applies the row limit and leaves out cell IDs on request', async () => {
    vi.stubGlobal('fetch', rangeFetcher(xeniumCellsFixtureBytes('cells_v1.parquet')))

    const { response, transfer } = await respondTo({
      url: CELLS_URL,
      includeCellIds: false,
      limit: 3,
    })

    expect(response).toMatchObject({
      ok: true,
      columns: {
        length: 3,
        cellIds: null,
        nucleusCounts: null,
        segmentationMethodIndices: null,
      },
    })
    expect(transfer).toHaveLength(4)
  })

  it('reports a failure with its error name', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )

    const { response, transfer } = await respondTo({
      url: CELLS_URL,
      includeCellIds: true,
    })

    expect(response).toEqual({
      ok: false,
      error: 'Failed to fetch',
      errorName: 'TypeError',
    })
    expect(transfer).toEqual([])
  })
})
