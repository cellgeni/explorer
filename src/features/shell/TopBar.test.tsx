import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  testDatasetInfoModel,
  testDatasetLibraryModel,
  testTopBarModel,
  testViewSettingsModel,
} from '../../test/sectionModels'
import { BuildCommitNote, TopBar } from './TopBar'
import { toolOptions } from './topBarModel'

function renderTopBar(
  props: Partial<Parameters<typeof TopBar>[0]> = {},
): ReturnType<typeof render> {
  return render(
    <TopBar
      model={testTopBarModel()}
      info={testDatasetInfoModel()}
      library={testDatasetLibraryModel()}
      settings={testViewSettingsModel()}
      infoOpen={false}
      onInfoOpenChange={vi.fn()}
      {...props}
    />,
  )
}

describe('TopBar', () => {
  it('shows the dataset, its summary and the active tool', () => {
    renderTopBar({ model: testTopBarModel({ tools: { active: 'lasso' } }) })

    expect(screen.getByRole('button', { name: /Sob23 brain/ })).toBeInTheDocument()
    expect(screen.getByText('Xenium · 1.41 M cells · 5,001 genes')).toHaveAttribute(
      'role',
      'status',
    )

    const tools = screen.getByRole('toolbar', { name: 'Tools' })
    expect(
      within(tools)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual(['Pan', 'Box selection', 'Lasso selection', 'Measure', 'Magic Lens'])
    expect(
      within(tools).getByRole('button', { name: 'Lasso selection' }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(within(tools).getByRole('button', { name: 'Pan' })).toHaveAttribute(
      'aria-keyshortcuts',
      'P',
    )
  })

  it('says which dataset is opening', () => {
    renderTopBar({
      model: testTopBarModel({
        datasetName: null,
        summary: { status: 'loading', name: 'next-run' },
      }),
    })

    expect(screen.getByRole('button', { name: /Open a dataset/ })).toBeInTheDocument()
    expect(screen.getByText('Opening next-run…')).toBeInTheDocument()
  })

  it('picks tools and explains disabled ones', () => {
    const model = testTopBarModel({
      tools: {
        options: toolOptions({
          datasetReady: false,
          canDrawRoi: false,
          magicLens: null,
        }),
      },
    })
    renderTopBar({ model })

    const box = screen.getByRole('button', { name: 'Box selection' })
    expect(box).toHaveAttribute('aria-disabled', 'true')
    fireEvent.focus(box)
    expect(screen.getByRole('tooltip', { hidden: false })).toHaveTextContent(
      'Box selection: Open a dataset',
    )
    expect(screen.queryByRole('button', { name: 'Magic Lens' })).not.toBeInTheDocument()

    fireEvent.click(box)
    fireEvent.click(screen.getByRole('button', { name: 'Pan' }))

    expect(model.tools.onSelect).toHaveBeenCalledWith('box')
    expect(model.tools.onSelect).toHaveBeenCalledWith('pan')
  })

  it('has one tab stop in the tools, and moves between them with arrows (15.5-D)', () => {
    renderTopBar()

    const toolbar = screen.getByRole('toolbar', { name: 'Tools' })
    const pan = within(toolbar).getByRole('button', { name: 'Pan' })
    const tools = within(toolbar).getAllByRole('button')
    expect(tools.filter((tool) => tool.tabIndex === 0)).toEqual([pan])

    pan.focus()
    fireEvent.keyDown(pan, { key: 'ArrowRight' })
    expect(within(toolbar).getByRole('button', { name: 'Box selection' })).toHaveFocus()
    fireEvent.keyDown(document.activeElement!, { key: 'End' })
    expect(tools.at(-1)).toHaveFocus()
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' })
    expect(pan).toHaveFocus()
    fireEvent.keyDown(pan, { key: 'ArrowLeft' })
    expect(tools.at(-1)).toHaveFocus()
  })

  it('sets the lens radius and summarises the view from the Magic Lens popover', () => {
    const model = testTopBarModel()
    renderTopBar({ model })

    fireEvent.click(screen.getByRole('button', { name: 'Magic Lens options' }))
    const popover = screen.getByRole('dialog', { name: 'Magic Lens options' })
    fireEvent.change(within(popover).getByLabelText('Radius'), {
      target: { value: '120' },
    })
    fireEvent.click(within(popover).getByRole('button', { name: 'Summarise View' }))

    expect(within(popover).getByText('80 µm')).toBeInTheDocument()
    expect(model.magicLens?.onRadiusChange).toHaveBeenCalledWith(120)
    expect(model.magicLens?.onSummariseView).toHaveBeenCalledTimes(1)
    expect(within(popover).queryByLabelText('Min QV')).not.toBeInTheDocument()
  })

  it('opens another dataset from the name menu and closes it', () => {
    const info = testDatasetInfoModel({ open: { datasetUrl: 'https://example.test/a' } })
    renderTopBar({ info })

    fireEvent.click(screen.getByRole('button', { name: /Sob23 brain/ }))
    const menu = screen.getByRole('dialog', { name: 'Open dataset' })
    fireEvent.change(within(menu).getByLabelText('Dataset or image URL'), {
      target: { value: 'https://example.test/b' },
    })
    fireEvent.click(within(menu).getByRole('button', { name: 'Load Dataset' }))

    expect(info.open.onDatasetUrlChange).toHaveBeenCalledWith('https://example.test/b')
    expect(info.open.onSubmit).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog', { name: 'Open dataset' })).not.toBeInTheDocument()
  })

  it('toggles the info drawer', () => {
    const onInfoOpenChange = vi.fn()
    renderTopBar({ onInfoOpenChange })

    fireEvent.click(screen.getByRole('button', { name: 'Dataset info' }))

    expect(onInfoOpenChange).toHaveBeenCalledWith(true)
    expect(document.querySelector('.shell-issue-badge')).toBeNull()
  })

  it('opens and closes the Embedding, Plots and Cell Query windows', () => {
    const onEmbeddingOpenChange = vi.fn()
    const onPlotsOpenChange = vi.fn()
    renderTopBar({
      panels: [
        { panel: 'embedding', open: true, onOpenChange: onEmbeddingOpenChange },
        { panel: 'plots', open: false, onOpenChange: onPlotsOpenChange },
        { panel: 'query', open: false, onOpenChange: vi.fn() },
      ],
    })

    const toggles = screen.getByRole('group', { name: 'Panels' })
    expect(
      within(toggles)
        .getAllByRole('button')
        .map((button) => [button.textContent, button.getAttribute('aria-pressed')]),
    ).toEqual([
      ['Embedding', 'true'],
      ['Plots', 'false'],
      ['Query', 'false'],
    ])
    const embedding = within(toggles).getByRole('button', { name: 'Embedding' })
    expect(embedding).toHaveAttribute('title', 'Hide the embedding panel')

    fireEvent.click(embedding)
    fireEvent.click(within(toggles).getByRole('button', { name: 'Plots' }))

    expect(onEmbeddingOpenChange).toHaveBeenCalledWith(false)
    expect(onPlotsOpenChange).toHaveBeenCalledWith(true)
  })

  it('leaves the window toggles out where there are no windows', () => {
    renderTopBar()

    expect(screen.queryByRole('group', { name: 'Panels' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Panels' })).toBeNull()
  })

  it('folds the window toggles into a menu on narrow screens', () => {
    const onQueryOpenChange = vi.fn()
    renderTopBar({
      narrow: true,
      panels: [
        { panel: 'embedding', open: true, onOpenChange: vi.fn() },
        { panel: 'query', open: false, onOpenChange: onQueryOpenChange },
      ],
    })

    expect(screen.queryByRole('group', { name: 'Panels' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Panels' }))
    const menu = screen.getByRole('dialog', { name: 'Panels' })
    expect(within(menu).getByRole('button', { name: 'Embedding' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    fireEvent.click(within(menu).getByRole('button', { name: 'Query' }))

    expect(onQueryOpenChange).toHaveBeenCalledWith(true)
    expect(screen.queryByRole('dialog', { name: 'Panels' })).toBeNull()
  })

  it('counts load issues on ⓘ', () => {
    const error = { title: 'Boundaries failed', message: 'HTTP 403' } as never
    renderTopBar({
      info: testDatasetInfoModel({ diagnostics: { errors: [error, error] } }),
    })

    expect(
      screen.getByRole('button', { name: 'Dataset info (2 issues)' }),
    ).toBeInTheDocument()
    expect(document.querySelector('.shell-issue-badge')).toHaveTextContent('2')
  })

  it('keeps the boundary limit under Advanced in the dataset menu', () => {
    renderTopBar()

    fireEvent.click(screen.getByRole('button', { name: /Sob23 brain/ }))

    expect(
      screen.getByTitle('Advanced dataset options').closest('details'),
    ).not.toHaveAttribute('open')
  })

  it('shows measure options only while measuring', () => {
    const settings = testViewSettingsModel()
    const { rerender } = renderTopBar({ settings })

    expect(
      screen.queryByRole('button', { name: 'Measure options' }),
    ).not.toBeInTheDocument()

    rerender(
      <TopBar
        model={testTopBarModel({ tools: { active: 'measure' } })}
        info={testDatasetInfoModel()}
        library={testDatasetLibraryModel()}
        settings={settings}
        infoOpen={false}
        onInfoOpenChange={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Measure options' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear Measurement' }))

    expect(settings.measure.onClear).toHaveBeenCalledTimes(1)
  })

  it('holds view settings and debug info in Settings', () => {
    const model = testTopBarModel()
    const settings = testViewSettingsModel()
    const info = testDatasetInfoModel()
    renderTopBar({ model, settings, info })

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    const panel = screen.getByRole('dialog', { name: 'Settings' })
    fireEvent.click(within(panel).getByLabelText('Hover tooltips'))
    fireEvent.click(within(panel).getByLabelText('Show navigation buttons'))
    fireEvent.click(within(panel).getByLabelText('Show legend'))
    fireEvent.click(within(panel).getByLabelText('Show scale bar'))
    fireEvent.change(within(panel).getByLabelText('Boundary limit'), {
      target: { value: '20000' },
    })
    fireEvent.click(within(panel).getByRole('switch', { name: 'Show debug info' }))

    expect(settings.onShowHoverTooltipsChange).toHaveBeenCalledWith(false)
    expect(settings.onShowNavigationChange).toHaveBeenCalledWith(false)
    expect(settings.onShowLegendChange).toHaveBeenCalledWith(false)
    expect(settings.onShowScaleBarChange).toHaveBeenCalledWith(false)
    expect(info.open.onBoundaryCellLimitChange).toHaveBeenCalledWith(20000)
    expect(model.onDebugModeChange).toHaveBeenCalledWith(true)
  })

  it('lists the shortcuts in Help', () => {
    renderTopBar()

    fireEvent.click(screen.getByRole('button', { name: 'Help' }))
    const tools = screen.getByRole('region', { name: 'Tools shortcuts' })

    expect(within(tools).getByText('Lasso selection tool')).toBeInTheDocument()
    expect(within(tools).getAllByText('L', { selector: 'kbd' })).toHaveLength(1)
  })

  it('shares the link and says it was copied', async () => {
    const info = testDatasetInfoModel({ share: { canCopyLink: true } })
    renderTopBar({ info })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Share' }))
      await Promise.resolve()
    })

    expect(info.share.onCopyLink).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Link copied')).toBeInTheDocument()
  })

  describe('a second Share', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('keeps "Link copied" for 2.5 s after it and says it again', async () => {
      vi.useFakeTimers()
      const info = testDatasetInfoModel({ share: { canCopyLink: true } })
      renderTopBar({ info })
      const share = async () => {
        await act(async () => {
          fireEvent.click(screen.getByRole('button', { name: 'Share' }))
          await vi.advanceTimersByTimeAsync(0)
        })
      }
      const wait = async (ms: number) => {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(ms)
        })
      }

      await share()
      const first = screen.getByText('Link copied')
      await wait(2_000)
      await share()

      // A new node, so the status region announces the second copy.
      const second = screen.getByText('Link copied')
      expect(second).not.toBe(first)
      await wait(2_000)
      expect(second).toBeInTheDocument()
      await wait(600)
      expect(screen.queryByText('Link copied')).toBeNull()
      expect(document.querySelector('.shell-share-status')).toBeEmptyDOMElement()
    })
  })

  it('opens Help with ?, listing the shortcuts and the guides (15.3-B)', () => {
    renderTopBar()

    fireEvent.keyDown(document.body, { key: '?', shiftKey: true })
    const help = screen.getByRole('dialog', { name: 'Help' })
    expect(within(help).getByText('Show or hide this help')).toBeInTheDocument()
    expect(within(help).getByText('Fit the data to the view')).toBeInTheDocument()
    const guides = within(help).getByRole('navigation', { name: 'Guides' })
    expect(within(guides).getByRole('link', { name: 'User guide' })).toHaveAttribute(
      'href',
      'https://github.com/cellgeni/explorer/blob/main/docs/user-guide.md',
    )
    expect(
      within(guides).getByRole('link', { name: 'Hosting your own data' }),
    ).toHaveAttribute('target', '_blank')

    fireEvent.keyDown(document.body, { key: '?', shiftKey: true })
    expect(screen.queryByRole('dialog', { name: 'Help' })).not.toBeInTheDocument()
  })

  it('names the deployed commit at the foot of Help', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567'
    vi.stubEnv('VITE_COMMIT_SHA', sha)
    try {
      renderTopBar()
      fireEvent.keyDown(document.body, { key: '?', shiftKey: true })
      const help = screen.getByRole('dialog', { name: 'Help' })
      expect(within(help).getByRole('link', { name: '0123456' })).toHaveAttribute(
        'href',
        `https://github.com/cellgeni/explorer/commit/${sha}`,
      )
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('leaves ? alone while typing', () => {
    renderTopBar()
    const search = document.createElement('input')
    document.body.append(search)

    fireEvent.keyDown(search, { key: '?', shiftKey: true })
    expect(screen.queryByRole('dialog', { name: 'Help' })).not.toBeInTheDocument()
    search.remove()
  })
})

describe('BuildCommitNote', () => {
  const commit = {
    short: '0123456',
    href: 'https://github.com/cellgeni/explorer/commit/0123456',
  }

  it("names a release build's tag beside its commit", () => {
    const { container, rerender } = render(
      <BuildCommitNote
        commit={commit}
        release={{
          tag: 'v0.1.0',
          href: 'https://github.com/cellgeni/explorer/releases/tag/v0.1.0',
        }}
      />,
    )

    expect(container.textContent).toBe('Release v0.1.0, build 0123456')
    expect(screen.getByRole('link', { name: 'v0.1.0' })).toHaveAttribute(
      'href',
      'https://github.com/cellgeni/explorer/releases/tag/v0.1.0',
    )

    rerender(<BuildCommitNote commit={commit} release={null} />)
    expect(container.textContent).toBe('Build 0123456')
  })
})
