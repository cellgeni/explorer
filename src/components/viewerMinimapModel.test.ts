import { describe, expect, it } from 'vitest'
import { micrometers } from '../data/coords'
import {
  MINIMAP_MAX_SIZE,
  minimapDeckTarget,
  minimapDrawsImage,
  minimapLayout,
  minimapPoints,
  minimapViewRect,
} from './viewerMinimapModel'

// 2,000 × 1,000 µm, in deck.gl coordinates (y negated).
const EXTENT = { minX: 0, maxX: 2_000, minY: -1_000, maxY: 0 }

describe('viewerMinimapModel', () => {
  it('keeps the extent’s shape within the size, centred on it', () => {
    const layout = minimapLayout(EXTENT)

    expect(layout).toMatchObject({
      width: MINIMAP_MAX_SIZE,
      height: MINIMAP_MAX_SIZE / 2,
    })
    expect(layout?.viewState.target).toEqual([1_000, -500, 0])
    expect(minimapLayout({ minX: 0, maxX: 10, minY: -1_000, maxY: 0 })).toMatchObject({
      width: 56,
      height: MINIMAP_MAX_SIZE,
    })
    expect(minimapLayout(null)).toBeNull()
  })

  it('draws the view’s box, clipped, and never smaller than 6 px', () => {
    const layout = minimapLayout(EXTENT)
    if (layout === null) throw new Error('Expected a layout.')

    const whole = minimapViewRect(
      {
        minX: micrometers(0),
        minY: micrometers(0),
        maxX: micrometers(2_000),
        maxY: micrometers(1_000),
      },
      layout,
    )
    expect(whole.left).toBeGreaterThan(0)
    expect(whole.width).toBeLessThan(layout.width)

    const tiny = minimapViewRect(
      {
        minX: micrometers(1_000),
        minY: micrometers(500),
        maxX: micrometers(1_001),
        maxY: micrometers(501),
      },
      layout,
    )
    expect(tiny.width).toBe(6)
    expect(tiny.left + tiny.width / 2).toBeCloseTo(layout.width / 2, 0)

    const beyond = minimapViewRect(
      {
        minX: micrometers(-5_000),
        minY: micrometers(-5_000),
        maxX: micrometers(5_000),
        maxY: micrometers(5_000),
      },
      layout,
    )
    expect(beyond).toEqual({
      left: 0,
      top: 0,
      width: layout.width,
      height: layout.height,
    })
  })

  it('turns a minimap point into a deck.gl target', () => {
    const layout = minimapLayout(EXTENT)
    if (layout === null) throw new Error('Expected a layout.')

    expect(
      minimapDeckTarget({ x: layout.width / 2, y: layout.height / 2 }, layout),
    ).toEqual([1_000, -500])
    const [x, y] = minimapDeckTarget({ x: layout.width, y: layout.height }, layout)
    expect(x).toBeGreaterThan(2_000)
    expect(y).toBeLessThan(-1_000)
  })

  it('samples points evenly', () => {
    const elements = Array.from({ length: 10 }, (_, index) => index)

    expect(minimapPoints(elements, (index) => [index, 0], 5)).toEqual([
      [0, 0],
      [2, 0],
      [4, 0],
      [6, 0],
      [8, 0],
    ])
    expect(
      minimapPoints(elements, (index) => (index < 5 ? null : [index, 0]), 20),
    ).toHaveLength(5)
  })

  it('draws dots rather than nothing when every channel is off', () => {
    const loader = {}
    expect(minimapDrawsImage(loader, [{ enabled: false }], null)).toBe(false)
    expect(minimapDrawsImage(loader, [{ enabled: true }], null)).toBe(true)
    expect(minimapDrawsImage(loader, [], null)).toBe(true)
    expect(minimapDrawsImage(null, [], null)).toBe(false)
    expect(minimapDrawsImage(null, [{ enabled: false }], {})).toBe(true)
  })
})
