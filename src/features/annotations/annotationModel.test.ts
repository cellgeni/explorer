import { describe, expect, it } from 'vitest'
import { asCellId } from '../../data/cellid'
import type { Annotation } from '../../datasets/spatialDataset'
import {
  annotationLabelsForCell,
  annotationSizePlots,
  annotationStatusCopy,
  colorsForAnnotations,
  customAnnotationFilePrefix,
  filterAnnotationsByVisibleSets,
  hasReadyAnnotationsAfterRemove,
  mergeImportedAnnotations,
  removeAnnotationColor,
  removeAnnotationColorsByPrefix,
} from './annotationModel'

const annotations: readonly Annotation[] = [
  { id: 'a', label: 'Astrocytes', cellIds: [asCellId('aaaaaaaa-1')] },
  { id: 'b', label: 'Neurons', cellIds: [asCellId('bbbbbbbb-2')] },
]

describe('annotationModel', () => {
  it('formats annotation load status', () => {
    expect(annotationStatusCopy({ status: 'idle' })).toBe('Idle')
    expect(annotationStatusCopy({ status: 'loading', url: 'https://example.test' })).toBe(
      'Loading',
    )
    expect(
      annotationStatusCopy({
        status: 'ready',
        url: 'https://example.test',
        annotations: annotations.slice(0, 1),
      }),
    ).toBe('1 label')
    expect(
      annotationStatusCopy({
        status: 'ready',
        url: 'https://example.test',
        annotations,
      }),
    ).toBe('2 labels')
    expect(
      annotationStatusCopy({
        status: 'error',
        url: 'https://example.test',
        error: new Error('failed'),
      }),
    ).toBe('Unavailable')
  })

  it('detects whether removing an annotation leaves ready annotations', () => {
    expect(
      hasReadyAnnotationsAfterRemove(
        { status: 'ready', url: 'https://example.test', annotations },
        'a',
      ),
    ).toBe(true)
    expect(
      hasReadyAnnotationsAfterRemove(
        {
          status: 'ready',
          url: 'https://example.test',
          annotations: annotations.slice(0, 1),
        },
        'a',
      ),
    ).toBe(false)
    expect(hasReadyAnnotationsAfterRemove({ status: 'idle' }, 'a')).toBe(false)
  })

  it('lists annotation labels for a selected cell', () => {
    expect(
      annotationLabelsForCell(
        {
          status: 'ready',
          url: 'https://example.test',
          annotations: [
            ...annotations,
            { id: 'c', label: 'Layer 1', cellIds: [asCellId('aaaaaaaa-1')] },
          ],
        },
        'aaaaaaaa-1',
      ),
    ).toEqual(['Astrocytes', 'Layer 1'])
    expect(annotationLabelsForCell({ status: 'idle' }, 'aaaaaaaa-1')).toEqual([])
  })

  it('summarizes annotation size plots by analysis grouping', () => {
    const plots = annotationSizePlots([
      {
        id: 'analysis:0:0',
        label: 'graphclust: 1',
        cellIds: [asCellId('aaaaaaaa-1')],
      },
      {
        id: 'analysis:0:1',
        label: 'graphclust: 2',
        cellIds: [asCellId('aaaaaaaa-1'), asCellId('bbbbbbbb-2')],
      },
      {
        id: 'analysis:1:0',
        label: 'kmeans 3: Cluster 1',
        cellIds: [asCellId('aaaaaaaa-1'), asCellId('bbbbbbbb-2'), asCellId('cccccccc-3')],
      },
      {
        id: 'custom:labels:astro',
        label: 'Astrocytes',
        cellIds: [asCellId('aaaaaaaa-1')],
      },
      {
        id: 'custom:metadata-csv:cell-type:t-cell',
        label: 'cell_type: T cell',
        cellIds: [asCellId('aaaaaaaa-1'), asCellId('bbbbbbbb-2')],
      },
      {
        id: 'custom:metadata-csv:cell-type:b-cell',
        label: 'cell_type: B cell',
        cellIds: [asCellId('cccccccc-3')],
      },
    ])

    expect(plots).toMatchObject([
      {
        label: 'graphclust',
        totalCellAssignments: 3,
        maxCellCount: 2,
        rows: [
          { label: '2', cellCount: 2, fraction: 2 / 3 },
          { label: '1', cellCount: 1, fraction: 1 / 3 },
        ],
      },
      {
        label: 'kmeans 3',
        totalCellAssignments: 3,
        rows: [{ label: 'Cluster 1', cellCount: 3, fraction: 1 }],
      },
      {
        label: 'Loaded annotations',
        totalCellAssignments: 1,
        rows: [{ label: 'Astrocytes', cellCount: 1, fraction: 1 }],
      },
      {
        label: 'cell_type',
        totalCellAssignments: 3,
        rows: [
          { label: 'T cell', cellCount: 2, fraction: 2 / 3 },
          { label: 'B cell', cellCount: 1, fraction: 1 / 3 },
        ],
      },
    ])
  })

  it('filters annotations by hidden annotation set id', () => {
    const visible = {
      id: 'custom:metadata-csv:cell-type:t-cell',
      label: 'cell_type: T cell',
      cellIds: [asCellId('aaaaaaaa-1')],
    }
    const hidden = {
      id: 'custom:metadata-csv:leiden:0',
      label: 'leiden: 0',
      cellIds: [asCellId('bbbbbbbb-2')],
    }

    expect(
      filterAnnotationsByVisibleSets(
        [visible, hidden],
        new Set(['custom:metadata-csv:leiden']),
      ),
    ).toEqual([visible])
  })

  it('merges imported annotations by prefix and maintains palette colors', () => {
    expect(
      mergeImportedAnnotations(
        [
          { id: 'custom:file:old', label: 'Old', cellIds: [] },
          { id: 'manual', label: 'Manual', cellIds: [] },
        ],
        [{ id: 'custom:file:new', label: 'New', cellIds: [] }],
        'custom:file:',
      ),
    ).toEqual([
      { id: 'manual', label: 'Manual', cellIds: [] },
      { id: 'custom:file:new', label: 'New', cellIds: [] },
    ])

    expect(colorsForAnnotations(annotations, { a: '#abcdef' })).toEqual({
      a: '#abcdef',
      b: '#ff7f0e',
    })
  })

  it('removes colors and builds custom import prefixes', () => {
    expect(removeAnnotationColor({ a: '#111111', b: '#222222' }, 'a')).toEqual({
      b: '#222222',
    })
    expect(
      removeAnnotationColorsByPrefix(
        { 'custom:file:a': '#111111', manual: '#222222' },
        'custom:file:',
      ),
    ).toEqual({ manual: '#222222' })
    expect(customAnnotationFilePrefix('My Labels.csv')).toBe('custom:my-labels-csv:')
  })
})
