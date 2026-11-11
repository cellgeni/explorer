import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { asCellId } from '../../data/cellid'
import { NO_ANNOTATION_GROUP_ID } from '../../data/datasetAnnotations'
import { testAnnotationsSectionModel } from '../../test/sectionModels'
import { AnnotationHudPanel } from './AnnotationHudPanel'

describe('AnnotationHudPanel', () => {
  it('renders annotation controls and forwards user actions', async () => {
    const onAnnotationGroupChange = vi.fn()
    const onLoadAnnotations = vi.fn()
    const onClearAnnotations = vi.fn()
    const onExportAnnotations = vi.fn()
    const onImportAnnotations = vi.fn()
    const onAnnotationImportUrlChange = vi.fn()
    const onImportAnnotationUrl = vi.fn(async () => {})
    const onAnnotationColorChange = vi.fn()
    const onAnnotationSetVisibilityChange = vi.fn()
    const onAnnotationVisibilityChange = vi.fn()
    const onRemoveAnnotation = vi.fn()
    const onRemoveCellMetadataTrack = vi.fn()
    const annotations = testAnnotationsSectionModel({
      headerCopy: '1 label',
      sets: {
        available: true,
        loadEnabled: true,
        selectedGroupId: 'cluster-a',
        groupOptions: [
          {
            id: 'cluster-a',
            label: 'Cluster A',
            groupingName: 'celltype',
            groupCount: 1,
          },
        ],
        onGroupChange: onAnnotationGroupChange,
        state: {
          status: 'ready',
          url: 'https://example.test/output',
          annotations: [
            {
              id: 'astro',
              label: 'Astrocytes',
              cellIds: [asCellId('aaaaaaaa-1')],
            },
          ],
        },
        groupState: {
          status: 'ready',
          url: 'https://example.test/output',
          groups: [],
        },
        onLoad: onLoadAnnotations,
        canClear: true,
        onClear: onClearAnnotations,
        onExport: onExportAnnotations,
        onImportFile: onImportAnnotations,
        importUrl: 'https://example.test/labels.csv',
        onImportUrlChange: onAnnotationImportUrlChange,
        onImportUrl: onImportAnnotationUrl,
        colors: { astro: '#123456' },
        hiddenSetIds: [],
        hiddenIds: ['astro'],
        onColorChange: onAnnotationColorChange,
        onSetVisibilityChange: onAnnotationSetVisibilityChange,
        onVisibilityChange: onAnnotationVisibilityChange,
        onRemove: onRemoveAnnotation,
      },
      metadataTracks: {
        tracks: [
          {
            id: 'metadata:confidence',
            label: 'confidence',
            values: [
              { cellId: asCellId('aaaaaaaa-1'), value: 0.5 },
              { cellId: asCellId('bbbbbbbb-2'), value: 0.7 },
            ],
            cellCount: 2,
            min: 0.5,
            max: 0.7,
          },
        ],
        onRemove: onRemoveCellMetadataTrack,
      },
      shapes: { enabled: false, shapes: [] },
    })

    render(<AnnotationHudPanel active annotations={annotations} />)

    fireEvent.change(screen.getByLabelText('Annotation set'), {
      target: { value: 'all' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Load Annotations' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear Annotations' }))
    fireEvent.change(screen.getByLabelText('Astrocytes color'), {
      target: { value: '#abcdef' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Export Annotations' }))
    fireEvent.click(screen.getByLabelText('Loaded annotations visible'))
    fireEvent.click(screen.getByLabelText('Astrocytes visible'))
    fireEvent.click(screen.getByRole('button', { name: 'Remove Astrocytes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove confidence' }))
    fireEvent.change(screen.getByLabelText('Import File'), {
      target: {
        files: [new File(['cell_id,label\n'], 'labels.csv', { type: 'text/csv' })],
      },
    })
    fireEvent.change(screen.getByLabelText('Annotation URL'), {
      target: { value: 'https://example.test/other-labels.csv' },
    })
    expect(onAnnotationImportUrlChange).toHaveBeenCalledWith(
      'https://example.test/other-labels.csv',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Import URL' }))

    expect(onAnnotationGroupChange).toHaveBeenCalledWith('all')
    expect(onLoadAnnotations).toHaveBeenCalledTimes(1)
    expect(onClearAnnotations).toHaveBeenCalledTimes(1)
    expect(onExportAnnotations).toHaveBeenCalledTimes(1)
    expect(onAnnotationColorChange).toHaveBeenCalledWith('astro', '#abcdef')
    expect(onAnnotationSetVisibilityChange).toHaveBeenCalledWith(
      'loaded-annotations',
      false,
    )
    expect(onAnnotationVisibilityChange).toHaveBeenCalledWith('astro', true)
    expect(onRemoveAnnotation).toHaveBeenCalledWith('astro')
    expect(onRemoveCellMetadataTrack).toHaveBeenCalledWith('metadata:confidence')
    expect(onImportAnnotations).toHaveBeenCalledWith(expect.any(File))
    await waitFor(() => {
      expect(onImportAnnotationUrl).toHaveBeenCalledWith(
        'https://example.test/labels.csv',
      )
    })
    // One list per set, with each label's count in its row.
    expect(
      within(screen.getByRole('group', { name: 'Loaded annotations' })).getByText('1'),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Astrocytes visible')).not.toBeChecked()
    expect(
      screen.getByRole('region', { name: 'Loaded annotations labels' }),
    ).toHaveTextContent('Astrocytes')
    expect(
      screen.getByRole('list', { name: 'Loaded metadata tracks' }),
    ).toHaveTextContent('confidence')
  })

  it('keeps annotation loading disabled until a group is selected', () => {
    const onAnnotationGroupChange = vi.fn()
    const annotations = testAnnotationsSectionModel({
      headerCopy: 'Idle',
      sets: {
        available: true,
        loadEnabled: true,
        selectedGroupId: NO_ANNOTATION_GROUP_ID,
        groupOptions: [
          {
            id: 'analysis:cell-type',
            label: 'cell_type',
            groupingName: 'cell_type',
            groupCount: 4,
          },
          {
            id: 'analysis:cell-type-id',
            label: 'cell_type_ontology_term_id',
            groupingName: 'cell_type_ontology_term_id',
            groupCount: 4,
          },
        ],
        onGroupChange: onAnnotationGroupChange,
        state: { status: 'idle' },
        groupState: {
          status: 'ready',
          url: 'https://example.test/output',
          groups: [],
        },
        canClear: false,
        importUrl: '',
      },
      shapes: { enabled: false, shapes: [] },
    })

    render(<AnnotationHudPanel active annotations={annotations} />)

    const annotationSet = screen.getByRole('combobox', { name: 'Annotation set' })

    expect(annotationSet).toHaveValue(NO_ANNOTATION_GROUP_ID)
    expect(screen.getByRole('button', { name: 'Load Annotations' })).toBeDisabled()
    expect(within(annotationSet).getByRole('option', { name: 'cell_type' })).toHaveValue(
      'analysis:cell-type',
    )
    // Identifier columns are listed apart.
    expect(
      within(
        within(annotationSet).getByRole('group', { name: 'More columns' }),
      ).getByRole('option'),
    ).toHaveTextContent('cell_type_ontology_term_id')

    fireEvent.change(annotationSet, { target: { value: 'analysis:cell-type' } })

    expect(onAnnotationGroupChange).toHaveBeenCalledWith('analysis:cell-type')
  })

  it('lists labels by annotation set with their sizes', () => {
    const annotations = testAnnotationsSectionModel({
      headerCopy: '3 labels',
      sets: {
        available: true,
        loadEnabled: true,
        selectedGroupId: 'all',
        groupOptions: [],
        state: {
          status: 'ready',
          url: 'https://example.test/output',
          annotations: [
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
              cellIds: [
                asCellId('aaaaaaaa-1'),
                asCellId('bbbbbbbb-2'),
                asCellId('cccccccc-3'),
              ],
            },
          ],
        },
        groupState: {
          status: 'ready',
          url: 'https://example.test/output',
          groups: [],
        },
        canClear: true,
        importUrl: '',
        colors: { 'analysis:0:1': '#abcdef' },
        hiddenSetIds: ['analysis:graphclust'],
        hiddenIds: [],
      },
      shapes: { enabled: false, shapes: [] },
    })

    render(<AnnotationHudPanel active annotations={annotations} />)

    const graphclustRows = within(
      screen.getByRole('region', { name: 'graphclust labels' }),
    ).getAllByRole('listitem')
    const kmeansRows = within(
      screen.getByRole('region', { name: 'kmeans 3 labels' }),
    ).getAllByRole('listitem')

    expect(graphclustRows[0]).toHaveTextContent('2')
    expect(graphclustRows[0]).toHaveTextContent('67%')
    expect(graphclustRows[1]).toHaveTextContent('1')
    expect(graphclustRows[1]).toHaveTextContent('33%')
    expect(kmeansRows[0]).toHaveTextContent('Cluster 1')
    expect(kmeansRows[0]).toHaveTextContent('100%')
    expect(screen.getByLabelText('graphclust visible')).not.toBeChecked()
    expect(screen.getByLabelText('kmeans 3 visible')).toBeChecked()
  })

  it('virtualizes long label lists', () => {
    const labels = Array.from({ length: 80 }, (_value, index) => ({
      id: `analysis:0:${index}`,
      label: `group: Label ${String(index).padStart(2, '0')}`,
      cellIds: [asCellId(`aaaaaaaa-${index}`)],
    }))
    const annotations = testAnnotationsSectionModel({
      headerCopy: '80 labels',
      sets: {
        available: true,
        loadEnabled: true,
        selectedGroupId: 'all',
        groupOptions: [],
        state: {
          status: 'ready',
          url: 'https://example.test/output',
          annotations: labels,
        },
        groupState: {
          status: 'ready',
          url: 'https://example.test/output',
          groups: [],
        },
        canClear: true,
        importUrl: '',
        colors: {},
        hiddenSetIds: [],
        hiddenIds: [],
      },
      shapes: { enabled: false, shapes: [] },
    })

    render(<AnnotationHudPanel active annotations={annotations} />)

    const setList = within(
      screen.getByRole('region', { name: 'group labels' }),
    ).getByRole('list')
    expect(within(setList).getAllByRole('listitem')).toHaveLength(12)
    expect(within(setList).queryByText('Label 79')).not.toBeInTheDocument()

    fireEvent.scroll(setList, {
      target: { scrollTop: 80 * 28 },
    })

    expect(within(setList).getByText('Label 79')).toBeInTheDocument()
  })
})
