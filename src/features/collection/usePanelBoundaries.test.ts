import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { LinkedViewState } from '../../components/linkedView'
import { micrometers, type BBox } from '../../data/coords'
import type { ElementBatch, SpatialElement } from '../../datasets/spatialDataset'
import { cellsInBox, panelViewBbox, type PanelBoundaryLoaders } from './panelBoundaries'
import { usePanelBoundaries } from './usePanelBoundaries'

const URL = 'https://example.test/s2.zarr'
// Three cells near the origin, the last below a 50 µm tall view, and one far
// away.
const POSITIONS = new Float32Array([0, 0, 10, 20, 30, 40, 5000, 5000])
// 2 px per µm on a 200 × 100 px panel: x -50 to 50, y -25 to 25 (deck y is
// the data's negated).
const VIEW: LinkedViewState = { target: [0, 0], zoom: 1 }
const SIZE = { width: 200, height: 100 }
const ELEMENT: SpatialElement = {
  id: 'cell-0',
  geometry: {
    kind: 'polygon',
    rings: [
      [
        { x: micrometers(-1), y: micrometers(-1) },
        { x: micrometers(1), y: micrometers(-1) },
        { x: micrometers(1), y: micrometers(1) },
      ],
    ],
  },
}

function loaders(
  options: {
    readonly has?: boolean
    readonly batches?: readonly ElementBatch[]
  } = {},
) {
  const batches = [...(options.batches ?? [{ elements: [ELEMENT] }])]
  const release = vi.fn()
  const value = {
    hasCellBoundaries: vi.fn(() => Promise.resolve(options.has ?? true)),
    loadBoundaryElements: vi.fn(() =>
      Promise.resolve(
        batches.length > 1 ? (batches.shift() as ElementBatch) : batches[0]!,
      ),
    ),
    retainDataset: vi.fn(() => release),
  } satisfies PanelBoundaryLoaders

  return { loaders: value, release }
}

function bbox(minX: number, maxX: number, minY: number, maxY: number): BBox {
  return {
    minX: micrometers(minX),
    maxX: micrometers(maxX),
    minY: micrometers(minY),
    maxY: micrometers(maxY),
  }
}

describe('panel view boxes', () => {
  it('finds the part of the section a panel shows, with y back the data’s way', () => {
    expect(panelViewBbox({ target: [10, -20], zoom: 1 }, SIZE)).toEqual(
      bbox(-40, 60, -5, 45),
    )
    expect(cellsInBox(POSITIONS, panelViewBbox(VIEW, SIZE))).toBe(2)
  })
})

describe('usePanelBoundaries', () => {
  it('reads the outlines for the view and a margin once the view rests', async () => {
    const { loaders: panelLoaders, release } = loaders()
    const { result, rerender } = renderHook(
      ({ enabled }) =>
        usePanelBoundaries({
          url: URL,
          enabled,
          loaders: panelLoaders,
          positions: POSITIONS,
          view: VIEW,
          size: SIZE,
          cellLimit: 50_000,
        }),
      { initialProps: { enabled: true } },
    )

    expect(result.current.status).toBe('checking')
    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })
    expect(result.current.elements).toEqual([ELEMENT])
    expect(result.current.visibleCellCount).toBe(2)
    expect(panelLoaders.retainDataset).toHaveBeenCalledWith(URL)
    // The view, 100 × 50 µm, and a quarter of it on each side.
    expect(panelLoaders.loadBoundaryElements).toHaveBeenCalledTimes(1)
    expect(panelLoaders.loadBoundaryElements).toHaveBeenCalledWith(
      URL,
      bbox(-75, 75, -37.5, 37.5),
      expect.objectContaining({ cellLimit: 50_000 }),
    )

    rerender({ enabled: false })
    expect(result.current.status).toBe('idle')
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('reads nothing while more cells than the limit are in view', async () => {
    const { loaders: panelLoaders } = loaders()
    const { result } = renderHook(() =>
      usePanelBoundaries({
        url: URL,
        enabled: true,
        loaders: panelLoaders,
        positions: POSITIONS,
        // Zoomed out: 400 × 200 µm, with three cells.
        view: { target: [0, 0], zoom: -1 },
        size: SIZE,
        cellLimit: 2,
      }),
    )

    await waitFor(() => {
      expect(result.current.status).toBe('zoom')
    })
    expect(result.current.visibleCellCount).toBe(3)
    expect(panelLoaders.loadBoundaryElements).not.toHaveBeenCalled()
  })

  it('reads the view alone when its margin holds too many outlines', async () => {
    const { loaders: panelLoaders } = loaders({
      batches: [{ elements: [], overLimit: {} }, { elements: [ELEMENT] }],
    })
    const { result } = renderHook(() =>
      usePanelBoundaries({
        url: URL,
        enabled: true,
        loaders: panelLoaders,
        positions: POSITIONS,
        view: { target: [0, 0], zoom: -1 },
        size: SIZE,
        cellLimit: 4,
      }),
    )

    await waitFor(() => {
      expect(result.current.status).toBe('ready')
    })
    expect(panelLoaders.loadBoundaryElements).toHaveBeenCalledTimes(2)
    expect(panelLoaders.loadBoundaryElements).toHaveBeenLastCalledWith(
      URL,
      bbox(-200, 200, -100, 100),
      expect.anything(),
    )
  })

  it('says when the dataset has no outlines, without reading any', async () => {
    const { loaders: panelLoaders } = loaders({ has: false })
    const { result } = renderHook(() =>
      usePanelBoundaries({
        url: URL,
        enabled: true,
        loaders: panelLoaders,
        positions: POSITIONS,
        view: VIEW,
        size: SIZE,
        cellLimit: 50_000,
      }),
    )

    await waitFor(() => {
      expect(result.current.status).toBe('none')
    })
    expect(panelLoaders.loadBoundaryElements).not.toHaveBeenCalled()
  })
})
