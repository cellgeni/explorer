import { describe, expect, it } from 'vitest'
import {
  dataToImagePixel,
  dataToScreen,
  imagePixelToData,
  imagePixels,
  imagePixelsToMicrometers,
  micrometers,
  micrometersToImagePixels,
  placeFrameBbox,
  screenPixels,
  screenToData,
  tileBounds,
  tilesForBbox,
  unplaceFrameBbox,
  viewportBbox,
} from './coords'
import type {
  BBox,
  ImageFramePlacement,
  OrthographicViewState,
  TileGrid,
  UnitsDescriptor,
  ViewportSize,
} from './coords'

const xeniumUnits: UnitsDescriptor = {
  dataUnit: 'micrometer',
  imageUnit: 'pixel',
  micrometersPerPixel: micrometers(0.2125),
  origin: 'top-left',
  imageYAxis: 'down',
}

describe('coordinate conversions', () => {
  it('round-trips screen and data coordinates with the POC orthographic transform', () => {
    const viewState: OrthographicViewState = {
      target: [micrometers(100), micrometers(200), 0],
      zoom: 1,
    }
    const viewport: ViewportSize = {
      width: screenPixels(400),
      height: screenPixels(200),
    }
    const dataPoint = { x: micrometers(120), y: micrometers(180) }
    const screenPoint = dataToScreen(dataPoint, viewState, viewport)

    expect(screenPoint).toEqual({ x: screenPixels(240), y: screenPixels(140) })
    expect(screenToData(screenPoint, viewState, viewport)).toEqual(dataPoint)
  })

  it('computes a sorted viewport bbox in data coordinates', () => {
    const viewState: OrthographicViewState = {
      target: [micrometers(100), micrometers(200), 0],
      zoom: 1,
    }
    const viewport: ViewportSize = {
      width: screenPixels(400),
      height: screenPixels(200),
    }

    expect(viewportBbox(viewState, viewport)).toEqual({
      minX: micrometers(0),
      maxX: micrometers(200),
      minY: micrometers(150),
      maxY: micrometers(250),
    })
  })

  it('converts Xenium micrometers to image pixels via dataset units', () => {
    expect(micrometersToImagePixels(micrometers(2.125), xeniumUnits)).toBe(
      imagePixels(10),
    )
    expect(imagePixelsToMicrometers(imagePixels(10), xeniumUnits)).toBe(
      micrometers(2.125),
    )
  })
})

describe('tile math', () => {
  const oneToOneUnits: UnitsDescriptor = {
    dataUnit: 'micrometer',
    imageUnit: 'pixel',
    micrometersPerPixel: micrometers(1),
    origin: 'top-left',
    imageYAxis: 'down',
  }
  const grid: TileGrid = {
    imageWidth: imagePixels(250),
    imageHeight: imagePixels(180),
    tileWidth: imagePixels(100),
    tileHeight: imagePixels(80),
  }

  it('computes clamped tile bounds in data coordinates', () => {
    expect(tileBounds(0, 2, 2, grid, oneToOneUnits)).toEqual({
      minX: micrometers(200),
      maxX: micrometers(250),
      minY: micrometers(160),
      maxY: micrometers(180),
    })
  })

  it('lists tile indices overlapping a bbox', () => {
    const bbox: BBox = {
      minX: micrometers(90),
      maxX: micrometers(210),
      minY: micrometers(70),
      maxY: micrometers(170),
    }

    expect(tilesForBbox(0, bbox, grid, oneToOneUnits)).toEqual([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 2, row: 0 },
      { col: 0, row: 1 },
      { col: 1, row: 1 },
      { col: 2, row: 1 },
      { col: 0, row: 2 },
      { col: 1, row: 2 },
      { col: 2, row: 2 },
    ])
  })

  it('lists no tiles for a bbox that misses the image', () => {
    // Left of the image: the grid's column 0 of rows 0 to 2 before 2026-11-16.
    expect(
      tilesForBbox(
        0,
        {
          minX: micrometers(-500),
          maxX: micrometers(-100),
          minY: micrometers(0),
          maxY: micrometers(200),
        },
        grid,
        oneToOneUnits,
      ),
    ).toEqual([])
    // Past the right edge, in the unused part of the last column's tiles,
    // which tileBounds clips to x 200–250: { col: 2, row: 0 } before.
    expect(
      tilesForBbox(
        0,
        {
          minX: micrometers(260),
          maxX: micrometers(280),
          minY: micrometers(0),
          maxY: micrometers(50),
        },
        grid,
        oneToOneUnits,
      ),
    ).toEqual([])
    // Touching the left edge.
    expect(
      tilesForBbox(
        0,
        {
          minX: micrometers(-50),
          maxX: micrometers(0),
          minY: micrometers(0),
          maxY: micrometers(50),
        },
        grid,
        oneToOneUnits,
      ),
    ).toEqual([])
  })

  it('lists the edge tiles a bbox reaches from off the image', () => {
    expect(
      tilesForBbox(
        0,
        {
          minX: micrometers(-500),
          maxX: micrometers(10),
          minY: micrometers(170),
          maxY: micrometers(400),
        },
        grid,
        oneToOneUnits,
      ),
    ).toEqual([{ col: 0, row: 2 }])
    expect(
      tilesForBbox(
        0,
        {
          minX: micrometers(240),
          maxX: micrometers(280),
          minY: micrometers(-50),
          maxY: micrometers(10),
        },
        grid,
        oneToOneUnits,
      ),
    ).toEqual([{ col: 2, row: 0 }])
  })

  it('measures a coarser level without a full-resolution size from its own pixels', () => {
    // Level 1 of the 250 × 180 px grid spans 500 × 360 µm.
    expect(tileBounds(1, 2, 2, grid, oneToOneUnits)).toEqual({
      minX: micrometers(400),
      maxX: micrometers(500),
      minY: micrometers(320),
      maxY: micrometers(360),
    })
    expect(
      tilesForBbox(
        1,
        {
          minX: micrometers(450),
          maxX: micrometers(600),
          minY: micrometers(340),
          maxY: micrometers(400),
        },
        grid,
        oneToOneUnits,
      ),
    ).toEqual([{ col: 2, row: 2 }])
  })
})

describe('image frame placement', () => {
  const frame: BBox = {
    minX: micrometers(0),
    maxX: micrometers(40),
    minY: micrometers(0),
    maxY: micrometers(20),
  }

  it('places a frame bbox flipped or with swapped axes', () => {
    // x' = y + 100, y' = -x + 220: axes swapped, then y flipped.
    const swapped: ImageFramePlacement = {
      a: 0,
      b: 1,
      c: micrometers(100),
      d: -1,
      e: 0,
      f: micrometers(220),
    }
    const flipped: ImageFramePlacement = {
      a: -1,
      b: 0,
      c: micrometers(50),
      d: 0,
      e: 1,
      f: micrometers(0),
    }

    expect(placeFrameBbox(swapped, frame)).toEqual({
      minX: 100,
      maxX: 120,
      minY: 180,
      maxY: 220,
    })
    expect(placeFrameBbox(flipped, frame)).toEqual({
      minX: 10,
      maxX: 50,
      minY: 0,
      maxY: 20,
    })
    expect(unplaceFrameBbox(swapped, placeFrameBbox(swapped, frame))).toEqual(frame)
    expect(unplaceFrameBbox(flipped, placeFrameBbox(flipped, frame))).toEqual(frame)
  })
})

describe('image pixel frames', () => {
  it('places pixels by origin, pixel size and placement, and back', () => {
    // Axes swapped, then y flipped: x' = y + 100, y' = -x + 220.
    const frame = {
      originX: 10,
      originY: 20,
      micrometersPerPixelX: 0.5,
      micrometersPerPixelY: 2,
      placement: {
        a: 0,
        b: 1,
        c: micrometers(100),
        d: -1,
        e: 0,
        f: micrometers(220),
      },
    }
    const point = imagePixelToData(frame, 4, 3)

    // Frame point (12, 26).
    expect(point).toEqual({ x: 126, y: 208 })
    expect(dataToImagePixel(frame, point)).toEqual({ x: 4, y: 3 })
    expect(
      dataToImagePixel(
        {
          originX: 0,
          originY: 0,
          micrometersPerPixelX: 0.25,
          micrometersPerPixelY: 0.25,
        },
        { x: micrometers(1), y: micrometers(2) },
      ),
    ).toEqual({ x: 4, y: 8 })
  })
})
