import { describe, expect, it } from 'vitest'
import { asAnyCellId, asCellId } from '../../data/cellid'
import { parseCustomAnnotations } from '../../data/customAnnotations'
import {
  IDLE_ANNOTATION_GROUP_STATE,
  IDLE_ANNOTATION_STATE,
  annotationGroupLoadFailed,
  annotationGroupLoadReady,
  annotationGroupLoadStarted,
  annotationLabelsForCell,
  annotationLoadFailed,
  annotationLoadReady,
  annotationLoadStarted,
  annotationSizePlots,
  defaultAnnotationGroupId,
  isIdLikeAnnotationGroup,
  annotationStatusCopy,
  annotationsToCsv,
  annotationIdsHiddenByLink,
  colorsForAnnotations,
  nextAnnotationColor,
  compactHiddenAnnotationIds,
  customAnnotationFilePrefix,
  filterAnnotationsByVisibleClasses,
  filterAnnotationsByVisibleSets,
  hasReadyAnnotationsAfterRemove,
  mergeImportedAnnotations,
  placedAnnotationCellCount,
  removeHiddenAnnotationIdsByPrefix,
  removeAnnotationColor,
  removeAnnotationColorsByPrefix,
} from './annotationModel'
import type { Annotation, AnnotationGroupOption } from '../../data/annotation'

const annotations: readonly Annotation[] = [
  { id: 'a', label: 'Astrocytes', cellIds: [asCellId('aaaaaaaa-1')] },
  { id: 'b', label: 'Neurons', cellIds: [asCellId('bbbbbbbb-2')] },
]

const annotationGroups: readonly AnnotationGroupOption[] = [
  { id: 'analysis:0', label: 'Graphclust', groupingName: 'graphclust', groupCount: 2 },
]

describe('annotationModel', () => {
  it('constructs annotation and annotation group transitions', () => {
    const error = new Error('failed')

    expect(IDLE_ANNOTATION_STATE).toEqual({ status: 'idle' })
    expect(annotationLoadStarted('https://example.test/output')).toEqual({
      status: 'loading',
      url: 'https://example.test/output',
    })
    expect(annotationLoadReady('https://example.test/output', annotations)).toEqual({
      status: 'ready',
      url: 'https://example.test/output',
      annotations,
    })
    expect(annotationLoadFailed('https://example.test/output', error)).toEqual({
      status: 'error',
      url: 'https://example.test/output',
      error,
    })

    expect(IDLE_ANNOTATION_GROUP_STATE).toEqual({ status: 'idle' })
    expect(annotationGroupLoadStarted('https://example.test/output')).toEqual({
      status: 'loading',
      url: 'https://example.test/output',
    })
    expect(
      annotationGroupLoadReady('https://example.test/output', annotationGroups),
    ).toEqual({
      status: 'ready',
      url: 'https://example.test/output',
      groups: annotationGroups,
    })
    expect(annotationGroupLoadFailed('https://example.test/output', error)).toEqual({
      status: 'error',
      url: 'https://example.test/output',
      error,
    })
  })

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

  it('serializes annotations as importable CSV', () => {
    expect(
      annotationsToCsv([
        {
          id: 'roi:1:marker-roi',
          label: 'Marker ROI',
          cellIds: [asCellId('aaaaaaaa-1'), asCellId('bbbbbbbb-2')],
        },
        {
          id: 'custom:labels:quoted',
          label: 'Layer "A", region',
          cellIds: [asCellId('cccccccc-3')],
        },
      ]),
    ).toBe(
      [
        'annotation_id,label,cell_id',
        'roi:1:marker-roi,Marker ROI,aaaaaaaa-1',
        'roi:1:marker-roi,Marker ROI,bbbbbbbb-2',
        'custom:labels:quoted,"Layer ""A"", region",cccccccc-3',
      ].join('\n'),
    )
  })

  it('exports labels and IDs a spreadsheet would run as formulas as text, and imports them back', () => {
    const exported = [
      {
        id: 'custom:labels:formula',
        label: '=HYPERLINK("https://example.org","x")',
        cellIds: [asAnyCellId('+1+cell'), asAnyCellId('-12')],
      },
      { id: 'custom:labels:dash', label: '-', cellIds: [asAnyCellId('@cell')] },
      { id: 'custom:labels:quote', label: "'=quoted", cellIds: [asAnyCellId('cell-4')] },
    ]
    const csv = annotationsToCsv(exported)

    expect(csv).toBe(
      [
        'annotation_id,label,cell_id',
        `custom:labels:formula,"'=HYPERLINK(""https://example.org"",""x"")",'+1+cell`,
        `custom:labels:formula,"'=HYPERLINK(""https://example.org"",""x"")",-12`,
        `custom:labels:dash,'-,'@cell`,
        `custom:labels:quote,''=quoted,cell-4`,
      ].join('\n'),
    )
    expect(
      parseCustomAnnotations(csv, 'annotations.csv').map(({ label, cellIds }) => ({
        label,
        cellIds,
      })),
    ).toEqual(exported.map(({ label, cellIds }) => ({ label, cellIds })))
  })

  it('counts each cell once in a set whose classes overlap', () => {
    const a = asCellId('aaaaaaaa-1')
    const b = asCellId('bbbbbbbb-2')
    const c = asCellId('cccccccc-3')
    const queries = [
      { id: 'query:1:cd3', label: 'CD3+', cellIds: [a, b, c] },
      { id: 'query:2:cd4', label: 'CD4+', cellIds: [a, b] },
    ]

    expect(annotationSizePlots(queries)).toMatchObject([
      {
        label: 'Queries',
        cellCount: 3,
        totalCellAssignments: 5,
        rows: [
          { label: 'CD3+', cellCount: 3, fraction: 1 },
          { label: 'CD4+', cellCount: 2, fraction: 2 / 3 },
        ],
      },
    ])
    // Only the cells on the map.
    expect(annotationSizePlots(queries, new Set<string>([a, c]))[0]).toMatchObject({
      cellCount: 2,
      rows: [
        { cellCount: 2, fraction: 1 },
        { cellCount: 1, fraction: 0.5 },
      ],
    })
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

  it('filters annotations by hidden annotation class id', () => {
    expect(filterAnnotationsByVisibleClasses(annotations, new Set(['b']))).toEqual([
      annotations[0],
    ])
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

    // The first palette colour no class has: a user's own colour leaves it free.
    expect(colorsForAnnotations(annotations, { a: '#abcdef' })).toEqual({
      a: '#abcdef',
      b: '#1f77b4',
    })
    expect(colorsForAnnotations(annotations, { a: '#1f77b4' })).toEqual({
      a: '#1f77b4',
      b: '#ff7f0e',
    })
    // Stored colours seed new classes; colours already set, and malformed
    // stored ones, do not.
    expect(
      colorsForAnnotations(
        [
          { id: 'a', color: '#008456' },
          { id: 'b', color: '#8E00F8' },
          { id: 'c', color: 'red' },
        ],
        { a: '#abcdef' },
      ),
    ).toEqual({ a: '#abcdef', b: '#8e00f8', c: '#1f77b4' })
    // A colour freed by a removal is used again before a later one.
    expect(
      colorsForAnnotations([{ id: 'd' }], {
        a: '#1f77b4',
        c: '#2ca02c',
      }),
    ).toEqual({ a: '#1f77b4', c: '#2ca02c', d: '#ff7f0e' })
    expect(nextAnnotationColor({ a: '#1f77b4', c: '#2ca02c' })).toBe('#ff7f0e')
  })

  it('writes a mostly hidden set by its shown classes, and reads it back', () => {
    const leiden = Array.from({ length: 150 }, (_, index) => ({
      id: `analysis:leiden:${index}`,
      label: `leiden: ${index}`,
      cellIds: [],
    }))
    const custom = [
      { id: 'custom:labels-csv:a', label: 'A', cellIds: [] },
      { id: 'custom:labels-csv:b', label: 'B', cellIds: [] },
    ]
    const annotations = [...leiden, ...custom]
    // "Only this class" for leiden 3, and one custom class hidden.
    const hidden = [
      ...leiden.filter((annotation) => annotation.id !== 'analysis:leiden:3'),
      custom[1],
    ].map((annotation) => annotation?.id ?? '')

    const compact = compactHiddenAnnotationIds(annotations, [...hidden, 'not-loaded'])

    expect(compact).toEqual({
      hidden: ['custom:labels-csv:b', 'not-loaded'],
      shown: ['analysis:leiden:3'],
    })
    expect(
      new Set(annotationIdsHiddenByLink(annotations, compact.hidden, compact.shown)),
    ).toEqual(new Set(hidden))
    // Half or fewer hidden: listed as hidden.
    expect(compactHiddenAnnotationIds(custom, ['custom:labels-csv:b'])).toEqual({
      hidden: ['custom:labels-csv:b'],
      shown: [],
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
    expect(
      removeHiddenAnnotationIdsByPrefix(
        ['custom:file:a', 'custom:file:b', 'manual'],
        'custom:file:',
      ),
    ).toEqual(['manual'])
  })

  it('counts only placed cells when some are hidden', () => {
    const annotations: Annotation[] = [
      {
        id: 'a',
        label: 'set: A',
        cellIds: [asCellId('aaaaaaaa-1'), asCellId('aaaaaaab-1'), asCellId('aaaaaaac-1')],
      },
    ]

    expect(annotationSizePlots(annotations)[0]?.rows[0]?.cellCount).toBe(3)
    expect(
      annotationSizePlots(annotations, new Set(['aaaaaaaa-1', 'aaaaaaac-1']))[0]?.rows[0]
        ?.cellCount,
    ).toBe(2)
  })

  it('gives the legend the same placed-cell count as the panel (15.5-E)', () => {
    const annotation: Annotation = {
      id: 'a',
      label: 'set: A',
      cellIds: [asCellId('aaaaaaaa-1'), asCellId('aaaaaaab-1'), asCellId('aaaaaaac-1')],
    }

    expect(placedAnnotationCellCount(annotation, null)).toBe(3)
    expect(placedAnnotationCellCount(annotation, new Set(['aaaaaaab-1']))).toBe(1)
  })

  it('picks graphclust, or the first set, as the default', () => {
    const group = (id: string, label: string): AnnotationGroupOption => ({
      id,
      label,
      groupingName: label,
      groupCount: 5,
    })

    expect(
      defaultAnnotationGroupId([
        group('analysis:1', 'kmeans 2'),
        group('analysis:0', 'graphclust'),
      ]),
    ).toBe('analysis:0')
    expect(defaultAnnotationGroupId([group('analysis:1', 'kmeans 2')])).toBe('analysis:1')
    expect(defaultAnnotationGroupId([])).toBeUndefined()
  })

  it('treats ontology IDs, join IDs and very large columns as identifiers', () => {
    const group = (label: string, groupCount = 10): AnnotationGroupOption => ({
      id: `h5ad:${label}`,
      label,
      groupingName: label,
      groupCount,
    })

    expect(isIdLikeAnnotationGroup(group('cell_type_ontology_term_id'))).toBe(true)
    expect(isIdLikeAnnotationGroup(group('observation_joinid'))).toBe(true)
    expect(isIdLikeAnnotationGroup(group('barcode', 501))).toBe(true)
    expect(isIdLikeAnnotationGroup(group('cell_type', 40))).toBe(false)
  })
})
