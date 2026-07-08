import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { asCellId } from '../../data/cellid'
import { NO_ANNOTATION_GROUP_ID } from '../../data/datasetAnnotations'
import { AnnotationHudPanel } from './AnnotationHudPanel'

function disabledGeometricAnnotationProps() {
  return {
    geometricAnnotations: [],
    geometricAnnotationsEnabled: false,
    onImportGeometricAnnotations: vi.fn(),
    onExportGeometricAnnotations: vi.fn(),
    onClearGeometricAnnotations: vi.fn(),
    onGeometricAnnotationColorChange: vi.fn(),
    onGeometricAnnotationVisibilityChange: vi.fn(),
    onRemoveGeometricAnnotation: vi.fn(),
  }
}

describe('AnnotationHudPanel', () => {
  it('renders annotation controls and forwards user actions', async () => {
    const onAnnotationGroupChange = vi.fn()
    const onLoadAnnotations = vi.fn()
    const onClearAnnotations = vi.fn()
    const onExportAnnotations = vi.fn()
    const onImportAnnotations = vi.fn()
    const onAnnotationImportUrlChange = vi.fn()
    const onImportAnnotationUrl = vi.fn(async () => true)
    const onAnnotationColorChange = vi.fn()
    const onAnnotationSetVisibilityChange = vi.fn()
    const onAnnotationVisibilityChange = vi.fn()
    const onRemoveAnnotation = vi.fn()
    const onRemoveCellMetadataTrack = vi.fn()

    render(
      <AnnotationHudPanel
        active
        annotationGroupInputId="annotation-group"
        annotationImportInputId="annotation-import"
        annotationImportUrlInputId="annotation-import-url"
        annotationImportUrl="https://example.test/labels.csv"
        annotationHeaderCopy="1 label"
        loadEnabled
        selectedAnnotationGroupId="cluster-a"
        annotationGroupOptions={[
          {
            id: 'cluster-a',
            label: 'Cluster A',
            groupingName: 'celltype',
            groupCount: 1,
          },
        ]}
        annotationState={{
          status: 'ready',
          url: 'https://example.test/output',
          annotations: [
            {
              id: 'astro',
              label: 'Astrocytes',
              cellIds: [asCellId('aaaaaaaa-1')],
            },
          ],
        }}
        annotationGroupState={{
          status: 'ready',
          url: 'https://example.test/output',
          groups: [],
        }}
        annotationColors={{ astro: '#123456' }}
        hiddenAnnotationSetIds={[]}
        hiddenAnnotationIds={['astro']}
        cellMetadataTracks={[
          {
            id: 'metadata:confidence',
            label: 'confidence',
            values: [
              { cellId: asCellId('aaaaaaaa-1'), value: 0.5 },
              { cellId: asCellId('bbbbbbbb-2'), value: 0.7 },
            ],
            min: 0.5,
            max: 0.7,
          },
        ]}
        {...disabledGeometricAnnotationProps()}
        onAnnotationGroupChange={onAnnotationGroupChange}
        onLoadAnnotations={onLoadAnnotations}
        onClearAnnotations={onClearAnnotations}
        onExportAnnotations={onExportAnnotations}
        onImportAnnotations={onImportAnnotations}
        onAnnotationImportUrlChange={onAnnotationImportUrlChange}
        onImportAnnotationUrl={onImportAnnotationUrl}
        onAnnotationColorChange={onAnnotationColorChange}
        onAnnotationSetVisibilityChange={onAnnotationSetVisibilityChange}
        onAnnotationVisibilityChange={onAnnotationVisibilityChange}
        onRemoveAnnotation={onRemoveAnnotation}
        onRemoveCellMetadataTrack={onRemoveCellMetadataTrack}
      />,
    )

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
    expect(
      within(screen.getByRole('list', { name: 'Loaded annotations' })).getByText('1'),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Astrocytes visible')).not.toBeChecked()
    expect(screen.getByRole('region', { name: 'Set sizes' })).toBeInTheDocument()
    expect(screen.getByLabelText('Loaded annotations cell counts')).toHaveTextContent(
      'Astrocytes',
    )
    expect(
      screen.getByRole('list', { name: 'Loaded metadata tracks' }),
    ).toHaveTextContent('confidence')
  })

  it('keeps annotation loading disabled until a group is selected', () => {
    const onAnnotationGroupChange = vi.fn()

    render(
      <AnnotationHudPanel
        active
        annotationGroupInputId="annotation-group"
        annotationImportInputId="annotation-import"
        annotationImportUrlInputId="annotation-import-url"
        annotationImportUrl=""
        annotationHeaderCopy="Idle"
        loadEnabled
        selectedAnnotationGroupId={NO_ANNOTATION_GROUP_ID}
        annotationGroupOptions={[
          {
            id: 'analysis:cell-type',
            label: 'cell_type',
            groupingName: 'cell_type',
            groupCount: 4,
          },
        ]}
        annotationState={{ status: 'idle' }}
        annotationGroupState={{
          status: 'ready',
          url: 'https://example.test/output',
          groups: [],
        }}
        annotationColors={{}}
        hiddenAnnotationSetIds={[]}
        hiddenAnnotationIds={[]}
        cellMetadataTracks={[]}
        {...disabledGeometricAnnotationProps()}
        onAnnotationGroupChange={onAnnotationGroupChange}
        onLoadAnnotations={vi.fn()}
        onClearAnnotations={vi.fn()}
        onExportAnnotations={vi.fn()}
        onImportAnnotations={vi.fn()}
        onAnnotationImportUrlChange={vi.fn()}
        onImportAnnotationUrl={vi.fn(async () => true)}
        onAnnotationColorChange={vi.fn()}
        onAnnotationSetVisibilityChange={vi.fn()}
        onAnnotationVisibilityChange={vi.fn()}
        onRemoveAnnotation={vi.fn()}
        onRemoveCellMetadataTrack={vi.fn()}
      />,
    )

    const annotationSet = screen.getByRole('combobox', { name: 'Annotation set' })

    expect(annotationSet).toHaveValue(NO_ANNOTATION_GROUP_ID)
    expect(screen.getByRole('button', { name: 'Load Annotations' })).toBeDisabled()
    expect(within(annotationSet).getByRole('option', { name: 'cell_type' })).toHaveValue(
      'analysis:cell-type',
    )

    fireEvent.change(annotationSet, { target: { value: 'analysis:cell-type' } })

    expect(onAnnotationGroupChange).toHaveBeenCalledWith('analysis:cell-type')
  })

  it('renders annotation size plots grouped by annotation set', () => {
    render(
      <AnnotationHudPanel
        active
        annotationGroupInputId="annotation-group"
        annotationImportInputId="annotation-import"
        annotationImportUrlInputId="annotation-import-url"
        annotationImportUrl=""
        annotationHeaderCopy="3 labels"
        loadEnabled
        selectedAnnotationGroupId="all"
        annotationGroupOptions={[]}
        annotationState={{
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
        }}
        annotationGroupState={{
          status: 'ready',
          url: 'https://example.test/output',
          groups: [],
        }}
        annotationColors={{ 'analysis:0:1': '#abcdef' }}
        hiddenAnnotationSetIds={['analysis:graphclust']}
        hiddenAnnotationIds={[]}
        cellMetadataTracks={[]}
        {...disabledGeometricAnnotationProps()}
        onAnnotationGroupChange={vi.fn()}
        onLoadAnnotations={vi.fn()}
        onClearAnnotations={vi.fn()}
        onExportAnnotations={vi.fn()}
        onImportAnnotations={vi.fn()}
        onAnnotationImportUrlChange={vi.fn()}
        onImportAnnotationUrl={vi.fn(async () => true)}
        onAnnotationColorChange={vi.fn()}
        onAnnotationSetVisibilityChange={vi.fn()}
        onAnnotationVisibilityChange={vi.fn()}
        onRemoveAnnotation={vi.fn()}
        onRemoveCellMetadataTrack={vi.fn()}
      />,
    )

    const graphclustRows = within(
      screen.getByLabelText('graphclust cell counts'),
    ).getAllByRole('listitem')
    const kmeansRows = within(screen.getByLabelText('kmeans 3 cell counts')).getAllByRole(
      'listitem',
    )

    expect(graphclustRows[0]).toHaveTextContent('2')
    expect(graphclustRows[0]).toHaveTextContent('67%')
    expect(graphclustRows[1]).toHaveTextContent('1')
    expect(graphclustRows[1]).toHaveTextContent('33%')
    expect(kmeansRows[0]).toHaveTextContent('Cluster 1')
    expect(kmeansRows[0]).toHaveTextContent('100%')
    expect(screen.getByLabelText('graphclust visible')).not.toBeChecked()
    expect(screen.getByLabelText('kmeans 3 visible')).toBeChecked()
  })

  it('virtualizes large annotation lists and size plots', () => {
    const annotations = Array.from({ length: 80 }, (_value, index) => ({
      id: `analysis:0:${index}`,
      label: `group: Label ${String(index).padStart(2, '0')}`,
      cellIds: [asCellId(`aaaaaaaa-${index}`)],
    }))

    render(
      <AnnotationHudPanel
        active
        annotationGroupInputId="annotation-group"
        annotationImportInputId="annotation-import"
        annotationImportUrlInputId="annotation-import-url"
        annotationImportUrl=""
        annotationHeaderCopy="80 labels"
        loadEnabled
        selectedAnnotationGroupId="all"
        annotationGroupOptions={[]}
        annotationState={{
          status: 'ready',
          url: 'https://example.test/output',
          annotations,
        }}
        annotationGroupState={{
          status: 'ready',
          url: 'https://example.test/output',
          groups: [],
        }}
        annotationColors={{}}
        hiddenAnnotationSetIds={[]}
        hiddenAnnotationIds={[]}
        cellMetadataTracks={[]}
        {...disabledGeometricAnnotationProps()}
        onAnnotationGroupChange={vi.fn()}
        onLoadAnnotations={vi.fn()}
        onClearAnnotations={vi.fn()}
        onExportAnnotations={vi.fn()}
        onImportAnnotations={vi.fn()}
        onAnnotationImportUrlChange={vi.fn()}
        onImportAnnotationUrl={vi.fn(async () => true)}
        onAnnotationColorChange={vi.fn()}
        onAnnotationSetVisibilityChange={vi.fn()}
        onAnnotationVisibilityChange={vi.fn()}
        onRemoveAnnotation={vi.fn()}
        onRemoveCellMetadataTrack={vi.fn()}
      />,
    )

    const annotationList = screen.getByRole('list', { name: 'Loaded annotations' })
    expect(within(annotationList).getAllByRole('listitem')).toHaveLength(12)
    expect(within(annotationList).queryByText('group: Label 79')).not.toBeInTheDocument()

    fireEvent.scroll(annotationList, {
      target: { scrollTop: 80 * 34 },
    })

    expect(within(annotationList).getByText('group: Label 79')).toBeInTheDocument()

    const sizeList = screen.getByLabelText('group cell counts')
    expect(within(sizeList).getAllByRole('listitem')).toHaveLength(12)
    expect(within(sizeList).queryByText('Label 79')).not.toBeInTheDocument()

    fireEvent.scroll(sizeList, {
      target: { scrollTop: 80 * 22 },
    })

    expect(within(sizeList).getByText('Label 79')).toBeInTheDocument()
  })
})
