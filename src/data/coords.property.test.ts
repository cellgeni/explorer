import fc from 'fast-check'
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

// Ranges that fit real data: coordinates up to about 1e5 µm, 0.05 to 20 µm
// per pixel, deck.gl zoom -6 to 6 and viewports up to 4000 px.
const MAX_MICROMETERS = 1e5

function finite(min: number, max: number): fc.Arbitrary<number> {
  return fc.double({ min, max, noNaN: true })
}

// Spread evenly over orders of magnitude, so 0.05 is as likely as 20.
function logUniform(min: number, max: number): fc.Arbitrary<number> {
  return finite(Math.log(min), Math.log(max)).map((value) =>
    Math.min(max, Math.max(min, Math.exp(value))),
  )
}

function units(micrometersPerPixel: number): UnitsDescriptor {
  return {
    dataUnit: 'micrometer',
    imageUnit: 'pixel',
    micrometersPerPixel: micrometers(micrometersPerPixel),
    origin: 'top-left',
    imageYAxis: 'down',
  }
}

function expectClose(
  actual: number,
  expected: number,
  tolerance: { readonly abs: number; readonly rel: number },
  label: string,
): void {
  const allowed = tolerance.abs + tolerance.rel * Math.abs(expected)

  if (!(Math.abs(actual - expected) <= allowed)) {
    throw new Error(
      `${label}: ${actual} differs from ${expected} by ${Math.abs(actual - expected)} (allowed ${allowed})`,
    )
  }
}

function expectWithin(
  value: number,
  min: number,
  max: number,
  eps: number,
  label: string,
) {
  if (!(value >= min - eps && value <= max + eps)) {
    throw new Error(`${label}: ${value} is outside [${min}, ${max}] (eps ${eps})`)
  }
}

const micrometersPerPixelArb = logUniform(0.05, 20)
const coordinateArb = finite(-MAX_MICROMETERS, MAX_MICROMETERS)
const viewStateArb: fc.Arbitrary<OrthographicViewState> = fc
  .record({
    x: finite(-1e3, MAX_MICROMETERS),
    y: finite(-1e3, MAX_MICROMETERS),
    zoom: finite(-6, 6),
  })
  .map(({ x, y, zoom }) => ({ target: [micrometers(x), micrometers(y), 0], zoom }))
const viewportArb: fc.Arbitrary<ViewportSize> = fc
  .record({
    width: fc.integer({ min: 1, max: 4000 }),
    height: fc.integer({ min: 1, max: 4000 }),
  })
  .map(({ width, height }) => ({
    width: screenPixels(width),
    height: screenPixels(height),
  }))
const fractionArb = finite(0, 1)

describe('coordinate round trips (property)', () => {
  it('converts micrometres to image pixels and back', () => {
    fc.assert(
      fc.property(coordinateArb, micrometersPerPixelArb, (distance, mpp) => {
        const descriptor = units(mpp)
        const pixels = micrometersToImagePixels(micrometers(distance), descriptor)
        const back = imagePixelsToMicrometers(pixels, descriptor)

        expectClose(back, distance, { abs: 1e-9, rel: 1e-12 }, 'µm → px → µm')
        expectClose(
          micrometersToImagePixels(
            imagePixelsToMicrometers(imagePixels(distance), descriptor),
            descriptor,
          ),
          distance,
          { abs: 1e-9, rel: 1e-12 },
          'px → µm → px',
        )
      }),
    )
  })

  it('maps data to screen and back', () => {
    fc.assert(
      fc.property(
        coordinateArb,
        coordinateArb,
        viewStateArb,
        viewportArb,
        (x, y, viewState, viewport) => {
          const point = { x: micrometers(x), y: micrometers(y) }
          const back = screenToData(
            dataToScreen(point, viewState, viewport),
            viewState,
            viewport,
          )

          expectClose(back.x, x, { abs: 1e-6, rel: 1e-12 }, 'x')
          expectClose(back.y, y, { abs: 1e-6, rel: 1e-12 }, 'y')
        },
      ),
    )
  })

  it('maps screen to data and back', () => {
    fc.assert(
      fc.property(
        finite(-1e4, 1e4),
        finite(-1e4, 1e4),
        viewStateArb,
        viewportArb,
        (x, y, viewState, viewport) => {
          const point = { x: screenPixels(x), y: screenPixels(y) }
          const back = dataToScreen(
            screenToData(point, viewState, viewport),
            viewState,
            viewport,
          )

          expectClose(back.x, x, { abs: 1e-6, rel: 1e-12 }, 'x')
          expectClose(back.y, y, { abs: 1e-6, rel: 1e-12 }, 'y')
        },
      ),
    )
  })
})

describe('viewportBbox (property)', () => {
  it('contains every point that maps inside the viewport', () => {
    fc.assert(
      fc.property(
        viewStateArb,
        viewportArb,
        fractionArb,
        fractionArb,
        (viewState, viewport, u, v) => {
          const bbox = viewportBbox(viewState, viewport)
          const point = screenToData(
            { x: screenPixels(u * viewport.width), y: screenPixels(v * viewport.height) },
            viewState,
            viewport,
          )
          const eps = 1e-6 + 1e-12 * MAX_MICROMETERS

          expectWithin(point.x, bbox.minX, bbox.maxX, eps, 'x')
          expectWithin(point.y, bbox.minY, bbox.maxY, eps, 'y')
        },
      ),
    )
  })

  it('maps every point inside it onto the viewport', () => {
    fc.assert(
      fc.property(
        viewStateArb,
        viewportArb,
        fractionArb,
        fractionArb,
        (viewState, viewport, u, v) => {
          const bbox = viewportBbox(viewState, viewport)
          const screen = dataToScreen(
            {
              x: micrometers(bbox.minX + u * (bbox.maxX - bbox.minX)),
              y: micrometers(bbox.minY + v * (bbox.maxY - bbox.minY)),
            },
            viewState,
            viewport,
          )

          expectWithin(screen.x, 0, viewport.width, 1e-6, 'screen x')
          expectWithin(screen.y, 0, viewport.height, 1e-6, 'screen y')
        },
      ),
    )
  })

  it('is centred on the view target and sized by the zoom', () => {
    fc.assert(
      fc.property(viewStateArb, viewportArb, (viewState, viewport) => {
        const bbox = viewportBbox(viewState, viewport)
        const scale = 2 ** viewState.zoom
        const tolerance = { abs: 1e-6, rel: 1e-12 }

        expectClose(
          (bbox.minX + bbox.maxX) / 2,
          viewState.target[0],
          tolerance,
          'centre x',
        )
        expectClose(
          (bbox.minY + bbox.maxY) / 2,
          viewState.target[1],
          tolerance,
          'centre y',
        )
        expectClose(bbox.maxX - bbox.minX, viewport.width / scale, tolerance, 'width')
        expectClose(bbox.maxY - bbox.minY, viewport.height / scale, tolerance, 'height')
      }),
    )
  })
})

interface TileScenario {
  readonly level: number
  readonly grid: TileGrid
  readonly units: UnitsDescriptor
  readonly imageWidthMicrometers: number
  readonly imageHeightMicrometers: number
}

// A pyramid level of an image up to about 1e5 µm across. Level sizes round
// up, as OME-TIFF and OME-Zarr pyramids do, so each level covers the image.
const tileScenarioArb: fc.Arbitrary<TileScenario> = micrometersPerPixelArb.chain(
  (mpp) => {
    const maxPixels = Math.max(1, Math.min(100_000, Math.floor(MAX_MICROMETERS / mpp)))

    return fc
      .record({
        level: fc.integer({ min: 0, max: 6 }),
        fullWidth: fc.integer({ min: 1, max: maxPixels }),
        fullHeight: fc.integer({ min: 1, max: maxPixels }),
        tileWidth: fc.integer({ min: 16, max: 1024 }),
        tileHeight: fc.integer({ min: 16, max: 1024 }),
      })
      .map(({ level, fullWidth, fullHeight, tileWidth, tileHeight }) => ({
        level,
        grid: {
          fullImageWidth: imagePixels(fullWidth),
          fullImageHeight: imagePixels(fullHeight),
          imageWidth: imagePixels(Math.ceil(fullWidth / 2 ** level)),
          imageHeight: imagePixels(Math.ceil(fullHeight / 2 ** level)),
          tileWidth: imagePixels(tileWidth),
          tileHeight: imagePixels(tileHeight),
        },
        units: units(mpp),
        imageWidthMicrometers: fullWidth * mpp,
        imageHeightMicrometers: fullHeight * mpp,
      }))
  },
)

// A bbox edge from a quarter of the extent before the image to a quarter
// after it, and a span of up to eight tiles (or the whole image, if smaller),
// so a case checks a bounded number of tiles.
function spanArb(
  extent: number,
  tileExtent: number,
): fc.Arbitrary<readonly [number, number]> {
  return fc.tuple(finite(-0.25, 1.25), fractionArb).map(([start, length]) => {
    const min = start * extent
    return [min, min + length * Math.min(1.5 * extent, 8 * tileExtent)] as const
  })
}

const tileCaseArb = tileScenarioArb.chain((scenario) => {
  const levelScale = scenario.units.micrometersPerPixel * 2 ** scenario.level

  return fc
    .record({
      x: spanArb(scenario.imageWidthMicrometers, scenario.grid.tileWidth * levelScale),
      y: spanArb(scenario.imageHeightMicrometers, scenario.grid.tileHeight * levelScale),
      u: fractionArb,
      v: fractionArb,
    })
    .map(({ x, y, u, v }) => ({
      scenario,
      bbox: {
        minX: micrometers(x[0]),
        maxX: micrometers(x[1]),
        minY: micrometers(y[0]),
        maxY: micrometers(y[1]),
      } satisfies BBox,
      u,
      v,
    }))
})

function overlapsImage(bbox: BBox, scenario: TileScenario): boolean {
  return (
    bbox.maxX > 0 &&
    bbox.minX < scenario.imageWidthMicrometers &&
    bbox.maxY > 0 &&
    bbox.minY < scenario.imageHeightMicrometers
  )
}

// Lies wholly past the last column or row of tiles.
function pastLastTile(bbox: BBox, scenario: TileScenario): boolean {
  const { grid } = scenario
  const levelScale = scenario.units.micrometersPerPixel * 2 ** scenario.level
  const nCols = Math.ceil(grid.imageWidth / grid.tileWidth)
  const nRows = Math.ceil(grid.imageHeight / grid.tileHeight)

  return (
    bbox.minX > nCols * grid.tileWidth * levelScale ||
    bbox.minY > nRows * grid.tileHeight * levelScale
  )
}

function boundsOf(scenario: TileScenario, col: number, row: number): BBox {
  return tileBounds(scenario.level, col, row, scenario.grid, scenario.units)
}

describe('tilesForBbox and tileBounds (property)', () => {
  it('returns only tiles that intersect a bbox over the image', () => {
    fc.assert(
      fc.property(
        tileCaseArb.filter(({ bbox, scenario }) => overlapsImage(bbox, scenario)),
        ({ scenario, bbox }) => {
          const tiles = tilesForBbox(scenario.level, bbox, scenario.grid, scenario.units)
          const eps = 1e-9 * MAX_MICROMETERS

          expect(tiles.length).toBeGreaterThan(0)

          for (const { col, row } of tiles) {
            const bounds = boundsOf(scenario, col, row)

            expect(bounds.minX).toBeLessThanOrEqual(bbox.maxX + eps)
            expect(bounds.maxX).toBeGreaterThanOrEqual(bbox.minX - eps)
            expect(bounds.minY).toBeLessThanOrEqual(bbox.maxY + eps)
            expect(bounds.maxY).toBeGreaterThanOrEqual(bbox.minY - eps)
          }
        },
      ),
    )
  })

  it('covers every point of the bbox that lies on the image', () => {
    fc.assert(
      fc.property(
        tileCaseArb.filter(({ bbox, scenario }) => overlapsImage(bbox, scenario)),
        ({ scenario, bbox, u, v }) => {
          const tiles = tilesForBbox(scenario.level, bbox, scenario.grid, scenario.units)
          const minX = Math.max(0, bbox.minX)
          const maxX = Math.min(scenario.imageWidthMicrometers, bbox.maxX)
          const minY = Math.max(0, bbox.minY)
          const maxY = Math.min(scenario.imageHeightMicrometers, bbox.maxY)
          const points = [
            [minX, minY],
            [maxX, minY],
            [minX, maxY],
            [maxX, maxY],
            [minX + u * (maxX - minX), minY + v * (maxY - minY)],
          ] as const
          const eps = 1e-9 * MAX_MICROMETERS

          for (const [x, y] of points) {
            const covered = tiles.some(({ col, row }) => {
              const bounds = boundsOf(scenario, col, row)

              return (
                x >= bounds.minX - eps &&
                x <= bounds.maxX + eps &&
                y >= bounds.minY - eps &&
                y <= bounds.maxY + eps
              )
            })

            if (!covered) {
              throw new Error(`(${x}, ${y}) is not covered by ${JSON.stringify(tiles)}`)
            }
          }
        },
      ),
    )
  })

  it('returns no tiles for a bbox past the last column or row of tiles', () => {
    fc.assert(
      fc.property(
        tileCaseArb.filter(({ bbox, scenario }) => pastLastTile(bbox, scenario)),
        ({ scenario, bbox }) => {
          expect(
            tilesForBbox(scenario.level, bbox, scenario.grid, scenario.units),
          ).toEqual([])
        },
      ),
    )
  })

  // Fails today: the tile indices come from the bbox clamped to the tile grid,
  // not to the image, so a bbox wholly outside the image still gets edge
  // tiles whose tileBounds do not meet it:
  // - left of or above the image (maxX < 0 or maxY < 0) gives column or row 0.
  //   fast-check shrinks this to { minX: 0, maxX: 0, minY: -4.9e-319,
  //   maxY: -4.9e-319 }, which gives [{ col: 0, row: 0 }].
  // - past the right or bottom edge but inside the unused part of a partial
  //   last tile gives that tile.
  // With a 250 × 180 px level at 1 µm/px in 100 × 80 px tiles,
  // { minX: -500, maxX: -100, minY: 0, maxY: 200 } gives column 0 of rows 0
  // to 2, and { minX: 260, maxX: 280, minY: 0, maxY: 50 } gives
  // { col: 2, row: 0 }, which tileBounds clips to x 200–250. The image loaders
  // (tiff/loader.ts and zarr/omeZarrLoader.ts) compute tiles the same way.
  it.todo('returns no tiles for a bbox that misses the image')

  it('tiles a level without gaps or overlaps', () => {
    fc.assert(
      fc.property(tileScenarioArb, (scenario) => {
        const { grid } = scenario
        const nCols = Math.ceil(grid.imageWidth / grid.tileWidth)
        const nRows = Math.ceil(grid.imageHeight / grid.tileHeight)
        const tolerance = { abs: 1e-9, rel: 1e-12 }

        for (let col = 1; col < nCols; col += 1) {
          expectClose(
            boundsOf(scenario, col, 0).minX,
            boundsOf(scenario, col - 1, 0).maxX,
            tolerance,
            `column ${col} edge`,
          )
        }

        for (let row = 1; row < nRows; row += 1) {
          expectClose(
            boundsOf(scenario, 0, row).minY,
            boundsOf(scenario, 0, row - 1).maxY,
            tolerance,
            `row ${row} edge`,
          )
        }

        const last = boundsOf(scenario, nCols - 1, nRows - 1)
        expectClose(last.maxX, scenario.imageWidthMicrometers, tolerance, 'right edge')
        expectClose(last.maxY, scenario.imageHeightMicrometers, tolerance, 'bottom edge')
      }),
    )
  })
})
