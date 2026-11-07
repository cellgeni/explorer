import { describe, expect, it } from 'vitest'
import { micrometers, type BBox } from '../data/coords'
import { snappedViewportClipKey, viewportClipBboxFromKey } from './viewportClip'

function bbox(minX: number, minY: number, width: number, height: number): BBox {
  return {
    minX: micrometers(minX),
    maxX: micrometers(minX + width),
    minY: micrometers(minY),
    maxY: micrometers(minY + height),
  }
}

describe('snapped viewport clip boxes', () => {
  it('covers the viewport with at least half a view of padding', () => {
    const viewport = bbox(1_030, 2_010, 300, 200)
    const clip = viewportClipBboxFromKey(snappedViewportClipKey(viewport))

    expect(clip.minX).toBeLessThanOrEqual(viewport.minX - 150)
    expect(clip.maxX).toBeGreaterThanOrEqual(viewport.maxX + 150)
    expect(clip.minY).toBeLessThanOrEqual(viewport.minY - 150)
    expect(clip.maxY).toBeGreaterThanOrEqual(viewport.maxY + 150)
  })

  it('keeps the same box for small pans and changes it after larger ones', () => {
    const key = snappedViewportClipKey(bbox(1_030, 2_010, 300, 200))

    expect(snappedViewportClipKey(bbox(1_040, 2_020, 300, 200))).toBe(key)
    expect(snappedViewportClipKey(bbox(1_400, 2_010, 300, 200))).not.toBe(key)
  })
})
