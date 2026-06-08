import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { asCellId } from '../../data/cellid'
import { AnnotationHudPanel } from './AnnotationHudPanel'

describe('AnnotationHudPanel', () => {
  it('renders annotation controls and forwards user actions', () => {
    const onAnnotationGroupChange = vi.fn()
    const onLoadAnnotations = vi.fn()
    const onClearAnnotations = vi.fn()
    const onImportAnnotations = vi.fn()
    const onAnnotationColorChange = vi.fn()
    const onRemoveAnnotation = vi.fn()

    render(
      <AnnotationHudPanel
        active
        annotationGroupInputId="annotation-group"
        annotationImportInputId="annotation-import"
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

    expect(onAnnotationGroupChange).toHaveBeenCalledWith('all')
    expect(onLoadAnnotations).toHaveBeenCalledTimes(1)
    expect(onClearAnnotations).toHaveBeenCalledTimes(1)
    expect(onAnnotationColorChange).toHaveBeenCalledWith('astro', '#abcdef')
    expect(onRemoveAnnotation).toHaveBeenCalledWith('astro')
    expect(onImportAnnotations).toHaveBeenCalledWith(expect.any(File))
    expect(
      within(screen.getByLabelText('Loaded annotations')).getByText('1'),
    ).toBeInTheDocument()
  })
})
