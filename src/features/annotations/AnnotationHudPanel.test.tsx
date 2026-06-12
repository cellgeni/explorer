import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { asCellId } from '../../data/cellid'
import { AnnotationHudPanel } from './AnnotationHudPanel'

describe('AnnotationHudPanel', () => {
  it('renders annotation controls and forwards user actions', async () => {
    const onAnnotationGroupChange = vi.fn()
    const onLoadAnnotations = vi.fn()
    const onClearAnnotations = vi.fn()
    const onImportAnnotations = vi.fn()
    const onAnnotationImportUrlChange = vi.fn()
    const onImportAnnotationUrl = vi.fn(async () => true)
    const onAnnotationColorChange = vi.fn()
    const onRemoveAnnotation = vi.fn()

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
        onAnnotationGroupChange={onAnnotationGroupChange}
        onLoadAnnotations={onLoadAnnotations}
        onClearAnnotations={onClearAnnotations}
        onImportAnnotations={onImportAnnotations}
        onAnnotationImportUrlChange={onAnnotationImportUrlChange}
        onImportAnnotationUrl={onImportAnnotationUrl}
        onAnnotationColorChange={onAnnotationColorChange}
        onRemoveAnnotation={onRemoveAnnotation}
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
    fireEvent.click(screen.getByRole('button', { name: 'Remove Astrocytes' }))
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
    expect(onAnnotationColorChange).toHaveBeenCalledWith('astro', '#abcdef')
    expect(onRemoveAnnotation).toHaveBeenCalledWith('astro')
    expect(onImportAnnotations).toHaveBeenCalledWith(expect.any(File))
    await waitFor(() => {
      expect(onImportAnnotationUrl).toHaveBeenCalledWith(
        'https://example.test/labels.csv',
      )
    })
    expect(
      within(screen.getByRole('list', { name: 'Loaded annotations' })).getByText('1'),
    ).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Set sizes' })).toBeInTheDocument()
    expect(screen.getByLabelText('Loaded annotations cell counts')).toHaveTextContent(
      'Astrocytes',
    )
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
        onAnnotationGroupChange={vi.fn()}
        onLoadAnnotations={vi.fn()}
        onClearAnnotations={vi.fn()}
        onImportAnnotations={vi.fn()}
        onAnnotationImportUrlChange={vi.fn()}
        onImportAnnotationUrl={vi.fn(async () => true)}
        onAnnotationColorChange={vi.fn()}
        onRemoveAnnotation={vi.fn()}
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
  })
})
