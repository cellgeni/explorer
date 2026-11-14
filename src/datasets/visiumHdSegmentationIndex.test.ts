import { describe, expect, it } from 'vitest'
import { micrometers, type BBox } from '../data/coords'
import type { SpatialElement } from './spatialDataset'
import {
  selectVisiumHdSegmentationIndexElements,
  visiumHdSegmentationIndexFromElements,
} from './visiumHdSegmentationIndex'

describe('Visium HD segmentation index', () => {
  it('stores rings, holes and metadata as columns', () => {
    const annotated = square('cell-a', 0, 0, 10, {
      segmentation: { kind: 'cell', annotation: { label: 'B cell', color: '#00ff00' } },
    })
    const withHole: SpatialElement = {
      id: 'cell-b',
      geometry: {
        kind: 'polygon',
        rings: [ring(20, 20, 10), ring(23, 23, 2)],
      },
    }
    const index = visiumHdSegmentationIndexFromElements([
      annotated,
      withHole,
      square('cell-c', 40, 40, 10, {
        segmentation: { kind: 'cell', annotation: { label: 'B cell', color: '#00ff00' } },
      }),
    ])

    expect(index.ids).toEqual(['cell-a', 'cell-b', 'cell-c'])
    expect(Array.from(index.bounds)).toEqual([
      0, 0, 10, 10, 20, 20, 30, 30, 40, 40, 50, 50,
    ])
    expect(Array.from(index.polygonRingOffsets)).toEqual([0, 1, 3, 4])
    expect(Array.from(index.ringOffsets)).toEqual([0, 8, 16, 24, 32])
    expect(Array.from(index.metadataIndexes)).toEqual([1, 0, 1])
    expect(index.metadata).toEqual([undefined, annotated.metadata])
  })

  it('selects polygons whose bounds meet the bbox, edges included, in file order', () => {
    const elements = [
      square('right', 20, 0, 10),
      square('inside', 2, 2, 4),
      square('touching', 10, 10, 5),
      square('below', 0, 30, 10),
    ]
    const index = visiumHdSegmentationIndexFromElements(elements)

    const selected = selectVisiumHdSegmentationIndexElements(index, bbox(0, 0, 10, 10))

    expect(Array.from(selected.keys())).toEqual([1, 2])
    expect(Array.from(selected.values())).toEqual([elements[1], elements[2]])
  })

  it('reuses the previous elements of polygons still in view', () => {
    const index = visiumHdSegmentationIndexFromElements([
      square('left', 0, 0, 10),
      square('right', 20, 0, 10),
    ])

    const first = selectVisiumHdSegmentationIndexElements(index, bbox(0, 0, 10, 10))
    const second = selectVisiumHdSegmentationIndexElements(
      index,
      bbox(0, 0, 30, 10),
      first,
    )

    expect(second.get(0)).toBe(first.get(0))
    expect(second.get(1)).toEqual(square('right', 20, 0, 10))
  })
})

function square(
  id: string,
  x: number,
  y: number,
  size: number,
  metadata?: SpatialElement['metadata'],
): SpatialElement {
  return {
    id,
    geometry: { kind: 'polygon', rings: [ring(x, y, size)] },
    ...(metadata === undefined ? {} : { metadata }),
  }
}

function ring(x: number, y: number, size: number) {
  return [
    { x: micrometers(x), y: micrometers(y) },
    { x: micrometers(x + size), y: micrometers(y) },
    { x: micrometers(x + size), y: micrometers(y + size) },
    { x: micrometers(x), y: micrometers(y + size) },
  ]
}

function bbox(minX: number, minY: number, maxX: number, maxY: number): BBox {
  return {
    minX: micrometers(minX),
    minY: micrometers(minY),
    maxX: micrometers(maxX),
    maxY: micrometers(maxY),
  }
}
