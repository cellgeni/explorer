import { describe, expect, it, vi } from 'vitest'
import { micrometers } from '../data/coords'
import {
  drawMorphologyTiles,
  morphologyViewportBbox,
  selectCenteredTiles,
} from './morphologyCanvas'
import type { ReadyTile } from '../tiff/tileCache'
import type { OverviewViewState } from './deckLayers'

const viewState: OverviewViewState = {
  target: [100, -200, 0],
  zoom: 0,
  minZoom: -10,
  maxZoom: 10,
}

describe('morphology canvas projection', () => {
  it('converts deck.gl viewport state into raw Xenium image coordinates', () => {
    expect(morphologyViewportBbox(viewState, { width: 200, height: 100 })).toEqual({
      minX: micrometers(0),
      maxX: micrometers(200),
      minY: micrometers(150),
      maxY: micrometers(250),
    })
  })

  it('draws raw image tiles in the negated deck.gl y coordinate space', () => {
    const image = {} as ImageBitmap
    const drawImage = vi.fn()
    const context = {
      clearRect: vi.fn(),
      drawImage,
    } as unknown as CanvasRenderingContext2D
    const tile: ReadyTile = {
      id: '0:0:0',
      image,
      bounds: {
        minX: micrometers(80),
        maxX: micrometers(120),
        minY: micrometers(180),
        maxY: micrometers(220),
      },
    }

    drawMorphologyTiles(context, [tile], viewState, { width: 200, height: 100 })

    expect(drawImage).toHaveBeenCalledWith(image, 80, 30, 40, 40)
  })

  it('selects center-nearest tiles before viewport edge tiles', () => {
    const tiles = [0, 1, 2, 3, 4].map((col) => ({ col, row: 0 }))
    const selected = selectCenteredTiles(
      tiles,
      3,
      {
        minX: micrometers(0),
        maxX: micrometers(50),
        minY: micrometers(0),
        maxY: micrometers(10),
      },
      (tile) => ({
        minX: micrometers(tile.col * 10),
        maxX: micrometers((tile.col + 1) * 10),
        minY: micrometers(0),
        maxY: micrometers(10),
      }),
    )

    expect(selected).toEqual([
      { col: 2, row: 0 },
      { col: 1, row: 0 },
      { col: 3, row: 0 },
    ])
  })
})
