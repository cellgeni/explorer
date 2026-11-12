import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CELL_FILL_OPACITY,
  DEFAULT_LAYER_OPACITY,
  normalizeLayerOpacity,
  opacityToPercent,
  percentToOpacity,
} from './layerOpacity'

describe('layer opacity', () => {
  it('keeps opacities inside 0 to 1', () => {
    expect(normalizeLayerOpacity(0)).toBe(0)
    expect(normalizeLayerOpacity(0.35)).toBe(0.35)
    expect(normalizeLayerOpacity(1)).toBe(1)
    expect(normalizeLayerOpacity(1.5)).toBe(1)
    expect(normalizeLayerOpacity(-0.2)).toBe(0)
  })

  it('uses the default layer opacity for values that are not finite', () => {
    expect(DEFAULT_LAYER_OPACITY).toBe(1)
    expect(normalizeLayerOpacity(Number.NaN)).toBe(DEFAULT_LAYER_OPACITY)
    expect(normalizeLayerOpacity(Number.POSITIVE_INFINITY)).toBe(DEFAULT_LAYER_OPACITY)
    expect(normalizeLayerOpacity(Number.NEGATIVE_INFINITY)).toBe(DEFAULT_LAYER_OPACITY)
  })

  it('shows opacity as a whole percentage', () => {
    expect(opacityToPercent(DEFAULT_CELL_FILL_OPACITY)).toBe(50)
    expect(opacityToPercent(0.333)).toBe(33)
    expect(opacityToPercent(0.005)).toBe(1)
    expect(opacityToPercent(0.004)).toBe(0)
    expect(opacityToPercent(2)).toBe(100)
    expect(opacityToPercent(-1)).toBe(0)
    expect(opacityToPercent(Number.NaN)).toBe(100)
  })

  it('reads a percentage back as a clamped opacity', () => {
    expect(percentToOpacity(50)).toBe(0.5)
    expect(percentToOpacity(0)).toBe(0)
    expect(percentToOpacity(100)).toBe(1)
    expect(percentToOpacity(140)).toBe(1)
    expect(percentToOpacity(-10)).toBe(0)
    expect(percentToOpacity(Number.NaN)).toBe(DEFAULT_LAYER_OPACITY)
    expect(percentToOpacity(Number.NEGATIVE_INFINITY)).toBe(DEFAULT_LAYER_OPACITY)
  })

  it('round-trips every whole percentage a slider can set', () => {
    for (let percent = 0; percent <= 100; percent += 1) {
      expect(opacityToPercent(percentToOpacity(percent))).toBe(percent)
    }
  })
})
