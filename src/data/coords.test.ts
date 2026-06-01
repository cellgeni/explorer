import { describe, expect, it } from 'vitest'
import {
  dataToScreen,
  imagePixels,
  imagePixelsToMicrometers,
  micrometers,
  micrometersToImagePixels,
  screenPixels,
  screenToData,
  tileBounds,
  tilesForBbox,
  viewportBbox,
} from './coords'
import type {
  BBox,
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
})
