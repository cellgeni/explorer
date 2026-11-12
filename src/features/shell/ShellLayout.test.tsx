import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
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
import type { CardStackModel } from '../cards/cardModels'
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

// The width crosses 860 px when the test calls the returned function.
function stubScreenWidthChange(narrow: boolean): (narrow: boolean) => void {
  let current = narrow
  const listeners = new Set<() => void>()
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      get matches() {
        return current && query === NARROW_SCREEN_QUERY
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
  return (next) => {
    act(() => {
      current = next
      for (const listener of listeners) listener()
    })
  }
}

// ResizeObserver calls back as each element is observed, and again on
// resize(); boxes come from the first listed class an element has.
function stubLayout(boxes: Readonly<Record<string, Partial<DOMRect>>>) {
  const observed: Element[] = []
  const callbacks = new Set<() => void>()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private readonly callback: () => void) {
        callbacks.add(callback)
      }
      observe(element: Element) {
        observed.push(element)
        this.callback()
      }
      unobserve() {}
      disconnect() {
        callbacks.delete(this.callback)
      }
    },
  )
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const name = Object.keys(boxes).find((candidate) =>
      this.classList.contains(candidate),
    )
    return { ...(name === undefined ? {} : boxes[name]) } as DOMRect
  })
  return {
    observed,
    resize: () => {
      for (const callback of callbacks) callback()
    },
  }
}

const NO_CARDS: CardStackModel = {
  selection: null,
  cell: null,
  transcript: null,
  magicLens: null,
}

const LENS_CARD: CardStackModel = {
  ...NO_CARDS,
  magicLens: {
    status: 'Move cursor',
    loading: false,
    scope: 'cursor',
    state: { status: 'idle' },
    onClose: vi.fn(),
  },
}

function renderShell(children: ReactNode = <div>canvas</div>) {
  return render(shell(children))
}

function shell(children: ReactNode, cards: CardStackModel = NO_CARDS) {
  return (
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
      cards={cards}
      embedding={testEmbeddingModel()}
      panels={DEFAULT_SHELL_PANELS}
      onPanelsChange={vi.fn()}
    >
      {children}
    </ShellLayout>
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
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
    const setNarrow = stubScreenWidthChange(false)
    renderShell()

    fireEvent.change(screen.getByLabelText('Gene selection'), {
      target: { value: 'SNAP' },
    })
    setNarrow(true)

    expect(screen.getByRole('button', { name: /^Layers/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(screen.getByLabelText('Gene selection')).toHaveValue('SNAP')
  })

  it('measures the bottom corners for the cards and toasts (15.5-E)', () => {
    const { observed } = stubLayout({
      'viewport-notification-stack': { left: 112, right: 532, height: 312.4 },
      // The stack is a fixed-width column; the legend is what covers.
      'viewer-legend': { left: 112, right: 372.2, height: 300 },
      'viewer-minimap': { left: 968, right: 1088, height: 168 },
      'shell-canvas': { left: 100, right: 1100, height: 800 },
    })
    stubScreenWidth(false)
    const { container } = renderShell(
      <>
        <div className="viewport-notification-stack">
          <div className="viewer-legend" />
        </div>
        <div className="viewer-minimap" />
      </>,
    )
    const canvas = container.querySelector<HTMLElement>('.shell-canvas')

    expect(observed).toHaveLength(3)
    expect(canvas?.style.getPropertyValue('--canvas-bottom-left-height')).toBe('313px')
    expect(canvas?.style.getPropertyValue('--canvas-bottom-left-width')).toBe('273px')
    expect(canvas?.style.getPropertyValue('--canvas-bottom-right-width')).toBe('132px')
  })

  it('lifts the overlays above a card docked under 860 px until it closes', async () => {
    stubLayout({
      'shell-canvas': {
        top: 48,
        bottom: 748,
        left: 0,
        right: 375,
        width: 375,
        height: 700,
      },
      'shell-card-stack': { top: 448.4, bottom: 748, left: 0, right: 375, height: 299.6 },
    })
    stubScreenWidth(true)
    const { container, rerender } = render(shell(<div>canvas</div>, LENS_CARD))
    const canvas = container.querySelector<HTMLElement>('.shell-canvas')

    expect(canvas?.style.getPropertyValue('--canvas-bottom-sheet-height')).toBe('300px')

    rerender(shell(<div>canvas</div>))
    await waitFor(() => {
      expect(canvas?.style.getPropertyValue('--canvas-bottom-sheet-height')).toBe('0px')
    })
  })

  it('leaves the overlays down once the cards stop docking over 860 px', () => {
    stubLayout({
      'shell-canvas': {
        top: 48,
        bottom: 748,
        left: 0,
        right: 900,
        width: 900,
        height: 700,
      },
      'shell-card-stack': { top: 448, bottom: 748, left: 0, right: 900, height: 300 },
    })
    const setNarrow = stubScreenWidthChange(true)
    const { container } = render(shell(<div>canvas</div>, LENS_CARD))
    const canvas = container.querySelector<HTMLElement>('.shell-canvas')
    expect(canvas?.style.getPropertyValue('--canvas-bottom-sheet-height')).toBe('300px')

    setNarrow(false)

    expect(canvas?.style.getPropertyValue('--canvas-bottom-sheet-height')).toBe('0px')
  })

  it('raises toasts above both corners when the gap is too narrow (15.5-E)', () => {
    // 1024 px: a 664 px canvas, the loading list under the legend at the
    // bottom left and the minimap 100 px up at the bottom right.
    const boxes: Record<string, Partial<DOMRect>> = {
      'shell-canvas': {
        top: 48,
        bottom: 768,
        left: 0,
        right: 664,
        width: 664,
        height: 720,
      },
      'viewport-notification-stack': { top: 400, left: 12, right: 432, height: 356 },
      'viewer-legend': { left: 12, right: 272 },
      'loading-indicator': { left: 12, right: 432 },
      'viewer-minimap': { top: 500, left: 480, right: 652, height: 168 },
      'viewer-toasts': { height: 60 },
    }
    const { resize } = stubLayout(boxes)
    stubScreenWidth(false)
    const { container } = renderShell(
      <>
        <div className="viewport-notification-stack">
          <div className="viewer-legend" />
          <div className="loading-indicator" />
        </div>
        <div className="viewer-minimap" />
        <div className="viewer-toasts" />
      </>,
    )
    const canvas = container.querySelector<HTMLElement>('.shell-canvas')

    // 48 px between the stack and the minimap; the stack's top is higher.
    expect(canvas).toHaveAttribute('data-toast-raised')
    expect(canvas?.style.getPropertyValue('--toast-bottom')).toBe('380px')

    // Never off the top of the canvas: 720 - 400 - 12.
    boxes['viewer-toasts'] = { height: 400 }
    resize()
    expect(canvas?.style.getPropertyValue('--toast-bottom')).toBe('308px')
  })

  it('keeps toasts between the corners when the gap holds them (15.5-E)', () => {
    stubLayout({
      'shell-canvas': {
        top: 48,
        bottom: 948,
        left: 0,
        right: 1100,
        width: 1100,
        height: 900,
      },
      'viewport-notification-stack': { top: 600, left: 12, right: 432, height: 336 },
      'viewer-legend': { left: 12, right: 272 },
      'viewer-minimap': { top: 600, left: 920, right: 1088, height: 168 },
    })
    stubScreenWidth(false)
    const { container } = renderShell(
      <>
        <div className="viewport-notification-stack">
          <div className="viewer-legend" />
        </div>
        <div className="viewer-minimap" />
        <div className="viewer-toasts" />
      </>,
    )
    const canvas = container.querySelector<HTMLElement>('.shell-canvas')

    // 1100 - 272 - 180 = 648 px between them.
    expect(canvas).not.toHaveAttribute('data-toast-raised')
    expect(canvas?.style.getPropertyValue('--toast-bottom')).toBe('')
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
