import { PolygonLayer } from '@deck.gl/layers'
import type { LayersList, Position } from '@deck.gl/core'
import type {
  GeometricAnnotationFeature,
  GeometricAnnotationRing,
} from '../features/annotations/geometricAnnotationModel'
import type { GeometricAnnotationDatum } from './deckLayerTypes'

const GEOMETRIC_ANNOTATION_FILL_ALPHA = 42
const GEOMETRIC_ANNOTATION_LINE_ALPHA = 230

export function geometricAnnotationsToLayerData(
  annotations: readonly GeometricAnnotationFeature[],
): readonly GeometricAnnotationDatum[] {
  return annotations.flatMap((annotation) => {
    if (!annotation.visible) {
      return []
    }

    const polygons =
      annotation.geometry.type === 'Polygon'
        ? [annotation.geometry.coordinates]
        : annotation.geometry.coordinates
    const rgb = hexToRgb(annotation.color)

    return polygons.map((rings, polygonIndex) => ({
      id: `${annotation.id}:${polygonIndex}`,
      annotationId: annotation.id,
      label: annotation.label,
      polygon: rings.map(ringToPositions),
      fillColor: [...rgb, GEOMETRIC_ANNOTATION_FILL_ALPHA],
      lineColor: [...rgb, GEOMETRIC_ANNOTATION_LINE_ALPHA],
    }))
  })
}

export function createGeometricAnnotationLayers(
  annotations: readonly GeometricAnnotationDatum[],
): LayersList {
  if (annotations.length === 0) {
    return []
  }

  return [
    new PolygonLayer<GeometricAnnotationDatum>({
      id: 'geometric-annotations',
      data: annotations,
      pickable: false,
      stroked: true,
      filled: true,
      opacity: 1,
      lineWidthUnits: 'pixels',
      lineWidthMinPixels: 1.5,
      getPolygon: (annotation) =>
        annotation.polygon.length === 1
          ? (annotation.polygon[0] ?? [])
          : annotation.polygon,
      getFillColor: (annotation) => annotation.fillColor,
      getLineColor: (annotation) => annotation.lineColor,
      getLineWidth: 1.5,
      updateTriggers: {
        getFillColor: [annotations],
        getLineColor: [annotations],
      },
    }),
  ]
}

function ringToPositions(ring: GeometricAnnotationRing): readonly Position[] {
  return ring.map((point) => [point.x, -point.y, 0])
}

function hexToRgb(color: string): readonly [number, number, number] {
  const normalized = /^#[0-9a-f]{6}$/i.test(color) ? color : '#1f77b4'
  const value = Number.parseInt(normalized.slice(1), 16)

  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
}
