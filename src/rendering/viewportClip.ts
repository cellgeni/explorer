import { micrometers, type BBox } from '../data/coords'

// Clip boxes for layers that only draw what is near the view. The box pads the
// viewport by at least half its size and snaps to a power-of-two grid, so it
// stays the same while the view pans within it and layers are not rebuilt on
// every frame.

export function snappedViewportClipKey(viewport: BBox): string {
  const span = Math.max(viewport.maxX - viewport.minX, viewport.maxY - viewport.minY, 1)
  const step = 2 ** Math.ceil(Math.log2(span / 2))

  return [
    Math.floor(viewport.minX / step) * step - step,
    Math.ceil(viewport.maxX / step) * step + step,
    Math.floor(viewport.minY / step) * step - step,
    Math.ceil(viewport.maxY / step) * step + step,
  ].join(',')
}

export function viewportClipBboxFromKey(key: string): BBox {
  const [minX = 0, maxX = 0, minY = 0, maxY = 0] = key.split(',').map(Number)

  return {
    minX: micrometers(minX),
    maxX: micrometers(maxX),
    minY: micrometers(minY),
    maxY: micrometers(maxY),
  }
}
