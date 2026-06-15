import { describe, expect, it, vi } from 'vitest'
import { imagePixels, micrometers } from '../data/coords'
import {
  drawMorphologyTiles,
  drawFlatImage,
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
      level: 0,
      image,
      bounds: {
        minX: micrometers(80),
        maxX: micrometers(120),
        minY: micrometers(180),
        maxY: micrometers(220),
      },
      sourceWidth: imagePixels(40),
      sourceHeight: imagePixels(40),
    }

    drawMorphologyTiles(context, [tile], viewState, { width: 200, height: 100 })

    expect(drawImage).toHaveBeenCalledWith(image, 0, 0, 40, 40, 80, 30, 40, 40)
  })

  it('crops padded partial tiles to their real source dimensions', () => {
    const image = {} as ImageBitmap
    const drawImage = vi.fn()
    const context = {
      clearRect: vi.fn(),
      drawImage,
    } as unknown as CanvasRenderingContext2D
    const tile: ReadyTile = {
      id: '8:0:0',
      level: 8,
      image,
      bounds: {
        minX: micrometers(0),
        maxX: micrometers(10900),
        minY: micrometers(0),
        maxY: micrometers(18700),
      },
      sourceWidth: imagePixels(200),
      sourceHeight: imagePixels(345),
    }

    drawMorphologyTiles(
      context,
      [tile],
      {
        target: [5450, -9350, 0],
        zoom: -5,
        minZoom: -10,
        maxZoom: 10,
      },
      { width: 400, height: 700 },
    )

    expect(drawImage).toHaveBeenCalledWith(
      image,
      0,
      0,
      200,
      345,
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    )
  })

  it('draws flat downsampled images in full-resolution micrometer coordinates', () => {
    const image = {} as CanvasImageSource
    const drawImage = vi.fn()
    const context = {
      clearRect: vi.fn(),
      drawImage,
    } as unknown as CanvasRenderingContext2D

    drawFlatImage(
      context,
      {
        image,
        size: [200, 100],
        scaleFactor: 0.5,
        micrometersPerPixel: 1,
      },
      {
        target: [100, -100, 0],
        zoom: 0,
        minZoom: -10,
        maxZoom: 10,
      },
      { width: 200, height: 200 },
    )

    expect(drawImage).toHaveBeenCalledWith(image, 0, 0, 200, 100, 0, 0, 400, 200)
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

  it('keeps all selected tiles center-prioritized even when under the cap', () => {
    const tiles = [0, 1, 2].map((col) => ({ col, row: 0 }))

    expect(
      selectCenteredTiles(
        tiles,
        3,
        {
          minX: micrometers(0),
          maxX: micrometers(30),
          minY: micrometers(0),
          maxY: micrometers(10),
        },
        (tile) => ({
          minX: micrometers(tile.col * 10),
          maxX: micrometers((tile.col + 1) * 10),
          minY: micrometers(0),
          maxY: micrometers(10),
        }),
      ),
    ).toEqual([
      { col: 1, row: 0 },
      { col: 0, row: 0 },
      { col: 2, row: 0 },
    ])
  })
})
