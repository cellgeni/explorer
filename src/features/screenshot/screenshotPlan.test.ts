import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { micrometers, type BBox, type TileIndex } from '../../data/coords'
import { rawDataPointToScreen } from '../../components/viewerMeasurements'
import type { OverviewViewState } from '../../rendering/deckLayerTypes'
import {
  SCREENSHOT_SCALES,
  scaledViewState,
  screenshotChannelRead,
  screenshotFrame,
  screenshotGrid,
  screenshotImageLevel,
  screenshotImageTiles,
  screenshotNotes,
  screenshotPixelSize,
  screenshotPrintSize,
  screenshotSizeLimitReason,
  screenshotTileViewState,
  screenshotUnitsPerPixel,
} from './screenshotPlan'

const view = (target: [number, number], zoom: number): OverviewViewState => ({
  target: [target[0], target[1], 0],
  zoom,
  minZoom: -10,
  maxZoom: 10,
})

// The level whose pixel is at most 1.5 screen pixels, as the loaders pick it,
// for a pyramid of halving levels.
const loader = {
  bestLevel: (deckScale: number) =>
    Math.max(0, Math.min(6, Math.floor(Math.log2(1.5 / deckScale)))),
}

describe('screenshot plan (plan 27, task B)', () => {
  it('takes the frame in whole CSS pixels', () => {
    expect(screenshotFrame({ width: 1234.4, height: 800.6 })).toEqual({
      width: 1234,
      height: 801,
    })
    expect(screenshotFrame({ width: 0.2, height: 0 })).toEqual({ width: 1, height: 1 })
  })

  it('refuses sizes over 16,384 px a side or 128 megapixels (D10)', () => {
    expect(screenshotSizeLimitReason({ width: 16_384, height: 8_192 })).toBeNull()
    expect(screenshotSizeLimitReason({ width: 16_385, height: 10 })).toMatch(/16,384 px/)
    expect(screenshotSizeLimitReason({ width: 12_000, height: 12_000 })).toMatch(
      /128 megapixels/,
    )
    expect(screenshotPixelSize({ width: 1500, height: 900 }, 4)).toEqual({
      width: 6000,
      height: 3600,
    })
  })

  it('covers the frame with tiles exactly, without overlap, on whole pixels (D9)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5000 }),
        fc.integer({ min: 1, max: 5000 }),
        fc.constantFrom(...SCREENSHOT_SCALES),
        (width, height, scale) => {
          const grid = screenshotGrid({ width, height }, scale)
          let area = 0

          for (const tile of grid.tiles) {
            expect(Number.isInteger(tile.x) && Number.isInteger(tile.y)).toBe(true)
            expect(Number.isInteger(tile.width) && Number.isInteger(tile.height)).toBe(
              true,
            )
            expect(tile.width * scale).toBeLessThanOrEqual(4096)
            expect(tile.height * scale).toBeLessThanOrEqual(4096)
            expect(tile.x + tile.width).toBeLessThanOrEqual(width)
            expect(tile.y + tile.height).toBeLessThanOrEqual(height)
            expect(tile.width).toBeLessThanOrEqual(grid.tileWidth)
            area += tile.width * tile.height
          }

          // Tiles inside the frame whose areas sum to the frame's cannot
          // overlap or leave a gap, as they lie on a grid.
          expect(area).toBe(width * height)
          for (const [index, tile] of grid.tiles.entries()) {
            for (const other of grid.tiles.slice(index + 1)) {
              const overlaps =
                tile.x < other.x + other.width &&
                other.x < tile.x + tile.width &&
                tile.y < other.y + other.height &&
                other.y < tile.y + tile.height
              expect(overlaps).toBe(false)
            }
          }
        },
      ),
      { numRuns: 60 },
    )
  })

  it('places a point at the same PNG pixel in its tile as in the frame', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 200, max: 3000 }),
        fc.integer({ min: 200, max: 3000 }),
        fc.constantFrom(...SCREENSHOT_SCALES),
        fc.double({ min: -3, max: 4, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (width, height, scale, zoom, u, v) => {
          const frame = { width, height }
          const viewState = view([1200, -900], zoom)
          const screen = { x: u * width, y: v * height }
          // The data point under that frame pixel.
          const k = 2 ** zoom
          const point = {
            x: micrometers(viewState.target[0] + (screen.x - width / 2) / k),
            y: micrometers(-viewState.target[1] + (screen.y - height / 2) / k),
          }
          expect(rawDataPointToScreen(point, viewState, frame).x).toBeCloseTo(screen.x, 6)
          const grid = screenshotGrid(frame, scale)
          const rect = grid.tiles.find(
            (tile) =>
              screen.x >= tile.x &&
              screen.x <= tile.x + tile.width &&
              screen.y >= tile.y &&
              screen.y <= tile.y + tile.height,
          )
          if (rect === undefined) return
          const inTile = rawDataPointToScreen(
            point,
            scaledViewState(screenshotTileViewState(viewState, frame, rect), scale),
            { width: rect.width * scale, height: rect.height * scale },
          )

          expect(inTile.x + rect.x * scale).toBeCloseTo(screen.x * scale, 5)
          expect(inTile.y + rect.y * scale).toBeCloseTo(screen.y * scale, 5)
        },
      ),
      { numRuns: 200 },
    )
  })

  it('reads the level a frame N times larger reads at 1× (D4)', () => {
    for (const zoom of [-4, -2.5, -1, 0, 0.75, 2]) {
      for (const scale of SCREENSHOT_SCALES) {
        expect(screenshotImageLevel(loader, zoom, scale)).toBe(
          screenshotImageLevel(loader, zoom + Math.log2(scale), 1),
        )
      }
    }
    expect(screenshotImageLevel(loader, -3, 1)).toBe(3)
    expect(screenshotImageLevel(loader, -3, 4)).toBe(1)
  })

  it('finds tiles in the loader’s frame for a flipped image', () => {
    const asked: BBox[] = []
    const flipped = {
      // y flipped about 0: the loader's frame runs the other way.
      placement: { a: 1, b: 0, c: micrometers(0), d: 0, e: -1, f: micrometers(0) },
      tilesForBbox: (_level: number, bbox: BBox): readonly TileIndex[] => {
        asked.push(bbox)
        return [{ col: 0, row: 0 }]
      },
    }

    screenshotImageTiles(
      flipped,
      0,
      view([50, -25], 0),
      { width: 100, height: 50 },
      { x: 0, y: 0, width: 100, height: 50 },
    )

    expect(asked[0]).toEqual({ minX: 0, maxX: 100, minY: -50, maxY: 0 })
  })

  it('counts each grid tile’s reads, and the frame’s tiles once', () => {
    const tiles = (bbox: BBox): readonly TileIndex[] => {
      const out: TileIndex[] = []
      for (let col = Math.floor(bbox.minX / 100); col * 100 < bbox.maxX; col += 1) {
        for (let row = Math.floor(bbox.minY / 100); row * 100 < bbox.maxY; row += 1) {
          out.push({ col, row })
        }
      }
      return out
    }
    const grid = { tileWidth: 150, tileHeight: 200, tiles: [] as never[] }
    const frame = { width: 300, height: 200 }
    const read = screenshotChannelRead(
      { ...loader, tilesForBbox: (_level, bbox) => tiles(bbox) },
      view([150, -100], 0),
      frame,
      {
        ...grid,
        tiles: [
          { x: 0, y: 0, width: 150, height: 200 },
          { x: 150, y: 0, width: 150, height: 200 },
        ],
      },
      1,
    )

    // Columns 0–2 over the frame; column 1 lies under both grid tiles.
    expect(read.frameTiles).toHaveLength(6)
    expect(read.reads).toBe(8)
  })

  it('gives µm per PNG pixel and the print size', () => {
    expect(screenshotUnitsPerPixel(0, 2)).toBe(0.5)
    expect(screenshotUnitsPerPixel(-2, 1)).toBe(4)
    expect(screenshotPrintSize({ width: 3000, height: 1800 }, 300)).toBe(
      '254 × 152 mm at 300 dpi',
    )
  })

  it('notes what the screen samples and what is still loading (D5, D7)', () => {
    expect(
      screenshotNotes({
        cells: { inView: 1_414_155, onScreen: 250_000 },
        expressionSampled: true,
        transcriptsAsDensity: true,
        loadingLabels: ['Loading cell boundaries'],
      }),
    ).toEqual([
      'Draws all 1,414,155 cells in view; the screen shows about 250,000.',
      'Expression is a sample at this zoom. Set Expression detail to All cells to colour every cell.',
      'Transcripts are density squares at this zoom. Set Detail to Exact, or zoom in, for points.',
      'Still loading: Loading cell boundaries. The screenshot shows what has loaded.',
    ])
    expect(
      screenshotNotes({
        cells: { inView: 500, onScreen: 500 },
        expressionSampled: false,
        transcriptsAsDensity: false,
        loadingLabels: [],
      }),
    ).toEqual([])
  })
})
