import { describe, expect, it, vi } from 'vitest'
import { micrometers } from '../../data/coords'
import type { CellOutlineRequest, SpatialElement } from '../../datasets/spatialDataset'
import { CellOutlineReader } from './cellOutlineReader'

const bbox = {
  minX: micrometers(0),
  maxX: micrometers(1),
  minY: micrometers(0),
  maxY: micrometers(1),
}

function request(id: string, overviewRow = 0): CellOutlineRequest {
  return { id, overviewRow, bbox }
}

function element(id: string): SpatialElement {
  return {
    id,
    geometry: {
      kind: 'circle',
      center: { x: micrometers(0), y: micrometers(0) },
      diameter: micrometers(4),
    },
  }
}

describe('cell outline reader (plan 23-H)', () => {
  it('reads a page in batches and keeps the outlines for the dataset', async () => {
    const load = vi.fn(async (cells: readonly CellOutlineRequest[]) => {
      return new Map(
        cells
          .filter((cell) => cell.id !== 'b')
          .map((cell) => [cell.id, element(cell.id)]),
      )
    })
    const reader = new CellOutlineReader(load, 2)
    const told: [string, string | null][] = []
    const onOutline = (cellId: string, outline: { kind: string } | null) => {
      told.push([cellId, outline?.kind ?? null])
    }

    await expect(
      reader.read(
        [request('a'), request('b'), request('c')],
        new AbortController().signal,
        onOutline,
      ),
    ).resolves.toBe(3)
    expect(load.mock.calls.map(([cells]) => cells.map((cell) => cell.id))).toEqual([
      ['a', 'b'],
      ['c'],
    ])
    expect(told).toEqual([
      ['a', 'circle'],
      ['b', null],
      ['c', 'circle'],
    ])

    // Read before: told at once, nothing loaded.
    told.splice(0)
    await expect(
      reader.read([request('b'), request('c')], new AbortController().signal, onOutline),
    ).resolves.toBe(0)
    expect(load).toHaveBeenCalledTimes(2)
    expect(told).toEqual([
      ['b', null],
      ['c', 'circle'],
    ])
  })

  it('keeps a batch that arrives after its page scrolled away, and stops there', async () => {
    const controller = new AbortController()
    const load = vi.fn(async (cells: readonly CellOutlineRequest[]) => {
      controller.abort()
      return new Map(cells.map((cell) => [cell.id, element(cell.id)]))
    })
    const reader = new CellOutlineReader(load, 1)
    const onOutline = vi.fn()

    await reader.read([request('a'), request('b')], controller.signal, onOutline)

    expect(load).toHaveBeenCalledOnce()
    expect(onOutline).not.toHaveBeenCalled()

    await reader.read([request('a')], new AbortController().signal, onOutline)
    expect(load).toHaveBeenCalledOnce()
    expect(onOutline).toHaveBeenCalledWith(
      'a',
      expect.objectContaining({ kind: 'circle' }),
    )
  })
})
