import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  testAnnotationsSectionModel,
  testCellsSectionModel,
  testDatasetInfoModel,
  testImageSectionModel,
  testTranscriptsSectionModel,
} from '../../test/sectionModels'
import { LayerPanel } from './LayerPanel'
import type { LayerSectionHeader, LayerSectionId } from './layerPanelModel'

const READY_PANEL = {
  status: 'ready',
  url: 'https://example.test/output',
  genes: ['Actb', 'Gad1'],
} as const

function header(
  id: LayerSectionId,
  title: string,
  overrides: Partial<LayerSectionHeader> = {},
): LayerSectionHeader {
  return {
    id,
    title,
    visible: true,
    onVisibleChange: vi.fn(),
    visibilityDisabled: false,
    summary: `${title} summary`,
    loading: false,
    ...overrides,
  }
}

function renderPanel(
  props: Partial<Parameters<typeof LayerPanel>[0]> = {},
): ReturnType<typeof render> {
  return render(
    <LayerPanel
      panel={{
        sections: [
          header('image', 'Image'),
          header('cells', 'Cells'),
          header('transcripts', 'Transcripts'),
          header('annotations', 'Annotations'),
        ],
      }}
      collapsed={false}
      onCollapsedChange={vi.fn()}
      image={testImageSectionModel()}
      cells={testCellsSectionModel({
        genes: { panelState: READY_PANEL, options: ['Actb', 'Gad1'] },
      })}
      transcripts={testTranscriptsSectionModel()}
      annotations={testAnnotationsSectionModel()}
      viewOptions={testDatasetInfoModel().viewOptions}
      embeddingOpen={false}
      onEmbeddingOpenChange={vi.fn()}
      {...props}
    />,
  )
}

describe('LayerPanel', () => {
  it('lists the sections with their state, Cells open', () => {
    renderPanel()

    const panel = screen.getByRole('complementary', { name: 'Layers' })
    expect(
      within(panel)
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual([
      'ImageImage summary',
      'CellsCells summary',
      'TranscriptsTranscripts summary',
      'AnnotationsAnnotations summary',
    ])
    expect(screen.getByRole('button', { name: /^Cells/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(screen.getByRole('region', { name: /^Cells/ })).toBeVisible()
    expect(screen.getByRole('button', { name: /^Image/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })

  it('opens the first section when there are no cells', () => {
    renderPanel({
      panel: {
        sections: [header('image', 'Image'), header('annotations', 'Annotations')],
      },
    })

    expect(screen.getByRole('button', { name: /^Image/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('opens sections and keeps their state while closed', () => {
    renderPanel()

    fireEvent.change(screen.getByLabelText('Gene selection'), {
      target: { value: 'gad' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^Cells/ }))
    expect(screen.getByRole('button', { name: /^Cells/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    fireEvent.click(screen.getByRole('button', { name: /^Transcripts/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Cells/ }))

    expect(screen.getByLabelText('Gene selection')).toHaveValue('gad')
    expect(screen.getByRole('region', { name: /^Transcripts/ })).toBeVisible()
  })

  it('hides layers from the header checkbox', () => {
    const cells = header('cells', 'Cells')
    const transcripts = header('transcripts', 'Transcripts', {
      visible: false,
      visibilityDisabled: true,
    })
    renderPanel({ panel: { sections: [cells, transcripts] } })

    fireEvent.click(screen.getByRole('checkbox', { name: 'Show Cells' }))

    expect(cells.onVisibleChange).toHaveBeenCalledWith(false)
    expect(screen.getByRole('checkbox', { name: 'Show Transcripts' })).toBeDisabled()
  })

  it('marks a loading section', () => {
    renderPanel({
      panel: { sections: [header('transcripts', 'Transcripts', { loading: true })] },
    })

    expect(screen.getByRole('img', { name: 'Loading' })).toBeInTheDocument()
  })

  it('collapses to a strip but keeps the sections mounted', () => {
    const onCollapsedChange = vi.fn()
    const { rerender } = renderPanel({ onCollapsedChange })

    fireEvent.change(screen.getByLabelText('Gene selection'), {
      target: { value: 'gad' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Hide layers (\\)' }))
    expect(onCollapsedChange).toHaveBeenCalledWith(true)

    rerender(
      <LayerPanel
        panel={{ sections: [header('cells', 'Cells')] }}
        collapsed
        onCollapsedChange={onCollapsedChange}
        image={testImageSectionModel()}
        cells={testCellsSectionModel({
          genes: { panelState: READY_PANEL, options: ['Actb', 'Gad1'] },
        })}
        transcripts={testTranscriptsSectionModel()}
        annotations={testAnnotationsSectionModel()}
        viewOptions={testDatasetInfoModel().viewOptions}
        embeddingOpen={false}
        onEmbeddingOpenChange={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: /^Cells/ })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Gene selection', { selector: 'input' })).toHaveValue(
      'gad',
    )
    expect(screen.getByRole('button', { name: 'Show layers (\\)' })).toBeInTheDocument()
  })

  it('puts the image, appearance, colour, genes and clusters in their sections', () => {
    renderPanel()
    for (const name of [/^Image/, /^Transcripts/, /^Annotations/]) {
      fireEvent.click(screen.getByRole('button', { name }))
    }

    const image = screen.getByRole('region', { name: /^Image/ })
    const cells = screen.getByRole('region', { name: /^Cells/ })
    const transcripts = screen.getByRole('region', { name: /^Transcripts/ })
    const shapes = screen.getByRole('region', { name: /^Annotations/ })

    expect(within(image).getByLabelText('Dataset image opacity')).toBeInTheDocument()
    expect(within(cells).getByLabelText('Cell fill opacity')).toBeInTheDocument()
    expect(within(cells).getByLabelText('Cell color')).toBeInTheDocument()
    expect(within(cells).getByLabelText('Annotation set')).toBeInTheDocument()
    expect(within(transcripts).getByLabelText('Feature filter')).toBeInTheDocument()
    expect(
      within(shapes).getByRole('heading', { name: 'GeoJSON shapes' }),
    ).toBeInTheDocument()
  })

  it('opens the Embedding panel from Cells', () => {
    const onEmbeddingOpenChange = vi.fn()
    const { rerender } = renderPanel({ onEmbeddingOpenChange })

    const cells = screen.getByRole('region', { name: /^Cells/ })
    fireEvent.click(within(cells).getByRole('button', { name: 'Show Embedding' }))
    expect(onEmbeddingOpenChange).toHaveBeenCalledWith(true)

    rerender(
      <LayerPanel
        panel={{ sections: [header('cells', 'Cells')] }}
        collapsed={false}
        onCollapsedChange={vi.fn()}
        image={testImageSectionModel()}
        cells={testCellsSectionModel()}
        transcripts={testTranscriptsSectionModel()}
        annotations={testAnnotationsSectionModel()}
        viewOptions={testDatasetInfoModel().viewOptions}
        embeddingOpen
        onEmbeddingOpenChange={onEmbeddingOpenChange}
      />,
    )
    expect(screen.getByRole('button', { name: 'Hide Embedding' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })
})
