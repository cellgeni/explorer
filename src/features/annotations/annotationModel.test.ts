import { describe, expect, it } from 'vitest'
import { asCellId } from '../../data/cellid'
import type { Annotation } from '../../datasets/spatialDataset'
import {
  annotationLabelsForCell,
  annotationStatusCopy,
  colorsForAnnotations,
  customAnnotationFilePrefix,
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
