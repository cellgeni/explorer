import { ScatterplotLayer } from '@deck.gl/layers'
import type { CellPointGeometry } from './cellPointStyle'
import { attributeDescriptor, samePackedLayerData } from './packedLayerData'
import type { ComposedPythonOverlay } from './pythonOverlay'

// The Python console's highlights (plan 29-D10): a ring around each
// highlighted cell, above the cells, in a layer of their own, so the cells'
// colours are not packed again.

export interface PythonHighlightRings {
  readonly name: string
  // RGBA, one array per ring set, so the layer's prop keeps its identity.
  readonly lineColor: [number, number, number, number]
  // x and y (deck orientation) per ring.
  readonly positions: Float64Array
  readonly radii: Float32Array
}

// Rings at least this wide on screen, so a highlighted cell shows at the
// full view, where cells are less than a pixel across.
const RING_RADIUS_MIN_PIXELS = 4
const RING_WIDTH_PIXELS = 2
const RING_ALPHA = 235

const ringsCache = new WeakMap<
  ComposedPythonOverlay,
  {
    readonly geometry: CellPointGeometry
    readonly rings: readonly PythonHighlightRings[]
  }
>()

export function pythonHighlightDraws(
  composed: ComposedPythonOverlay,
  geometry: CellPointGeometry,
): readonly PythonHighlightRings[] {
  if (composed.highlights.length === 0) return NO_RINGS
  const cached = ringsCache.get(composed)
  if (cached?.geometry === geometry) return cached.rings

  const rings = composed.highlights.map((highlight) => {
    const { rows } = highlight
    const positions = new Float64Array(rows.length * 2)
    const radii = new Float32Array(rows.length)
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index] ?? 0
      positions[index * 2] = geometry.positions[row * 2] ?? 0
      positions[index * 2 + 1] = geometry.positions[row * 2 + 1] ?? 0
      radii[index] = geometry.radii[row] ?? 0
    }
    const lineColor: [number, number, number, number] = [...highlight.color, RING_ALPHA]
    return { name: highlight.name, lineColor, positions, radii }
  })
  ringsCache.set(composed, { geometry, rings })
  return rings
}

const NO_RINGS: readonly PythonHighlightRings[] = []

export function createPythonHighlightLayers(
  rings: readonly PythonHighlightRings[],
  radiusScale: number,
): ScatterplotLayer[] {
  return rings
    .filter((ring) => ring.radii.length > 0)
    .map(
      (ring) =>
        new ScatterplotLayer({
          id: `python-highlight:${ring.name}`,
          data: {
            length: ring.radii.length,
            attributes: {
              getPosition: attributeDescriptor(ring.positions, 2),
              getRadius: attributeDescriptor(ring.radii, 1),
            },
          } as unknown as ScatterplotLayer['props']['data'],
          dataComparator: samePackedLayerData,
          pickable: false,
          filled: false,
          stroked: true,
          radiusUnits: 'common',
          radiusScale,
          radiusMinPixels: RING_RADIUS_MIN_PIXELS,
          lineWidthUnits: 'pixels',
          getLineWidth: RING_WIDTH_PIXELS,
          lineWidthMinPixels: RING_WIDTH_PIXELS,
          getLineColor: ring.lineColor,
          opacity: 1,
        }),
    )
}
