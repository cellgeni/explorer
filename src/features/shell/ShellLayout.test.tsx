import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  testAnnotationsSectionModel,
  testCellsSectionModel,
  testDatasetInfoModel,
  testDatasetLibraryModel,
  testEmbeddingModel,
  testImageSectionModel,
  testTopBarModel,
  testTranscriptsSectionModel,
  testViewSettingsModel,
} from '../../test/sectionModels'
import { DEFAULT_SHELL_PANELS } from './shellLinkModel'
import { ShellLayout } from './ShellLayout'
import { NARROW_SCREEN_QUERY } from './useNarrowScreen'

function stubScreenWidth(narrow: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: narrow && query === NARROW_SCREEN_QUERY,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  )
}

function renderShell() {
  return render(
    <ShellLayout
      topBar={testTopBarModel()}
      info={testDatasetInfoModel()}
      library={testDatasetLibraryModel()}
      settings={testViewSettingsModel()}
      layerPanel={{
        sections: [
          {
            id: 'cells',
            title: 'Cells',
            visible: true,
            onVisibleChange: vi.fn(),
            visibilityDisabled: false,
            summary: 'graphclust',
            loading: false,
          },
        ],
      }}
      image={testImageSectionModel()}
      cells={testCellsSectionModel()}
      transcripts={testTranscriptsSectionModel()}
      annotations={testAnnotationsSectionModel()}
      cards={{ selection: null, cell: null, transcript: null, magicLens: null }}
      embedding={testEmbeddingModel()}
      panels={DEFAULT_SHELL_PANELS}
      onPanelsChange={vi.fn()}
    >
      <div>canvas</div>
    </ShellLayout>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ShellLayout', () => {
  it('docks the layer panel and shows the tool row on wide screens', () => {
    stubScreenWidth(false)
    renderShell()

    expect(screen.getByRole('complementary', { name: 'Layers' })).toBeInTheDocument()
    expect(screen.getByRole('toolbar', { name: 'Tools' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Share/ })).toHaveTextContent('Share')
  })

  it('turns the panel into a bottom sheet and folds the tools under 860 px (15.2-I)', () => {
    stubScreenWidth(true)
    renderShell()

    expect(screen.queryByRole('toolbar', { name: 'Tools' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Share' })).toHaveTextContent('')

    const sheet = screen.getByRole('complementary', { name: 'Layers' })
    expect(within(sheet).queryByRole('button', { name: /^Hide layers/ })).toBeNull()
    const handle = within(sheet).getByRole('button', { name: /^Layers/ })
    expect(handle).toHaveTextContent('Cells: graphclust')
    expect(handle).toHaveAttribute('aria-expanded', 'false')

    fireEvent.keyDown(document.body, { key: '\\' })
    expect(handle).toHaveAttribute('aria-expanded', 'true')
    expect(within(sheet).getByRole('button', { name: /^Cells/ })).toBeVisible()
  })

  it('keeps a gene search when the window crosses 860 px (15.5-B)', () => {
    let narrow = false
    const listeners = new Set<() => void>()
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        get matches() {
          return narrow && query === NARROW_SCREEN_QUERY
        },
        media: query,
        addEventListener: (_type: string, listener: () => void) => {
          listeners.add(listener)
        },
        removeEventListener: (_type: string, listener: () => void) => {
          listeners.delete(listener)
        },
      })),
    )
    renderShell()

    fireEvent.change(screen.getByLabelText('Gene selection'), {
      target: { value: 'SNAP' },
    })
    act(() => {
      narrow = true
      for (const listener of listeners) listener()
    })

    expect(screen.getByRole('button', { name: /^Layers/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(screen.getByLabelText('Gene selection')).toHaveValue('SNAP')
  })

  it('picks a tool from the menu, which then closes', () => {
    stubScreenWidth(true)
    const topBar = testTopBarModel()
    render(
      <ShellLayout
        topBar={topBar}
        info={testDatasetInfoModel()}
        library={testDatasetLibraryModel()}
        settings={testViewSettingsModel()}
        layerPanel={{ sections: [] }}
        image={testImageSectionModel()}
        cells={testCellsSectionModel()}
        transcripts={testTranscriptsSectionModel()}
        annotations={testAnnotationsSectionModel()}
        cards={{ selection: null, cell: null, transcript: null, magicLens: null }}
        embedding={null}
        panels={DEFAULT_SHELL_PANELS}
        onPanelsChange={vi.fn()}
      >
        <div>canvas</div>
      </ShellLayout>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Tools: Pan' }))
    const menu = screen.getByRole('dialog', { name: 'Tools' })
    expect(
      within(menu)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['PanP', 'Box selectionR', 'Lasso selectionL', 'MeasureM', 'Magic LensO'])

    fireEvent.click(within(menu).getByRole('button', { name: /Lasso selection/ }))
    expect(topBar.tools.onSelect).toHaveBeenCalledWith('lasso')
    expect(screen.queryByRole('dialog', { name: 'Tools' })).not.toBeInTheDocument()
  })
})
