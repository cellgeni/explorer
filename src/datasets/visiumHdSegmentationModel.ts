import type { BBox, DataPoint } from '../data/coords'
import type { SegmentationInfo, SpatialElement } from './spatialDataset'

export interface VisiumHdSegmentedOutputPaths {
  readonly scalefactorsPath?: string
  readonly filteredFeatureCellMatrixH5Path?: string
  readonly rawFeatureCellMatrixH5Path?: string
  readonly cellSegmentationsGeojsonPath?: string
  readonly nucleusSegmentationsGeojsonPath?: string
  readonly nucleusInstanceMaskTiffPath?: string
  readonly graphclustAnnotatedCellSegmentationsGeojsonPath?: string
  readonly graphclustAnnotatedNucleusSegmentationsGeojsonPath?: string
}

export type VisiumHdSegmentationKind = 'cell' | 'nucleus'

export function visiumHdSegmentationInfos(
  paths: VisiumHdSegmentedOutputPaths | undefined,
): readonly SegmentationInfo[] {
  if (paths === undefined) {
    return []
  }

  const segmentations: SegmentationInfo[] = []

  appendSegmentationInfo(segmentations, {
    id: 'visium-hd-cell-segmentations',
    kind: 'cell',
    label: 'Cell segmentations',
    sourceKind: 'geojson',
    path: paths.cellSegmentationsGeojsonPath,
  })
  appendSegmentationInfo(segmentations, {
    id: 'visium-hd-nucleus-segmentations',
    kind: 'nucleus',
    label: 'Nucleus segmentations',
    sourceKind: 'geojson',
    path: paths.nucleusSegmentationsGeojsonPath,
  })
  appendSegmentationInfo(segmentations, {
    id: 'visium-hd-graphclust-cell-segmentations',
    kind: 'cell',
    label: 'Graphclust cell segmentations',
    sourceKind: 'geojson',
    path: paths.graphclustAnnotatedCellSegmentationsGeojsonPath,
    annotated: true,
  })
  appendSegmentationInfo(segmentations, {
    id: 'visium-hd-graphclust-nucleus-segmentations',
    kind: 'nucleus',
    label: 'Graphclust nucleus segmentations',
    sourceKind: 'geojson',
    path: paths.graphclustAnnotatedNucleusSegmentationsGeojsonPath,
    annotated: true,
  })
  appendSegmentationInfo(segmentations, {
    id: 'visium-hd-nucleus-instance-mask',
    kind: 'nucleus',
    label: 'Nucleus instance mask',
    sourceKind: 'tiff',
    path: paths.nucleusInstanceMaskTiffPath,
  })

  return segmentations
}

export function filterVisiumHdSegmentationElementsByBbox(
  elements: readonly SpatialElement[],
  bbox: BBox,
): readonly SpatialElement[] {
  return elements.filter((element) => elementIntersectsBbox(element, bbox))
}

function appendSegmentationInfo(
  target: SegmentationInfo[],
  candidate: Omit<SegmentationInfo, 'path'> & { readonly path: string | undefined },
): void {
  if (candidate.path === undefined) {
    return
  }

  target.push({
    ...candidate,
    path: candidate.path,
  })
}

function elementIntersectsBbox(element: SpatialElement, bbox: BBox): boolean {
  if (element.geometry.kind !== 'polygon') {
    return false
  }

  for (const ring of element.geometry.rings) {
    for (const point of ring) {
      if (
        point.x >= bbox.minX &&
        point.x <= bbox.maxX &&
        point.y >= bbox.minY &&
        point.y <= bbox.maxY
      ) {
        return true
      }
    }
  }

  return polygonBboxIntersectsBbox(element.geometry.rings, bbox)
}

function polygonBboxIntersectsBbox(
  rings: readonly (readonly DataPoint[])[],
  bbox: BBox,
): boolean {
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const ring of rings) {
    for (const point of ring) {
      minX = Math.min(minX, point.x)
      maxX = Math.max(maxX, point.x)
      minY = Math.min(minY, point.y)
      maxY = Math.max(maxY, point.y)
    }
  }

  if (
    !Number.isFinite(minX) ||
    !Number.isFinite(maxX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(maxY)
  ) {
    return false
  }

  return maxX >= bbox.minX && minX <= bbox.maxX && maxY >= bbox.minY && minY <= bbox.maxY
}
