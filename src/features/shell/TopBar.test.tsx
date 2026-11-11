import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  testDatasetInfoModel,
  testTopBarModel,
  testViewSettingsModel,
} from '../../test/sectionModels'
import { TopBar } from './TopBar'
import { toolOptions } from './topBarModel'

function renderTopBar(
  props: Partial<Parameters<typeof TopBar>[0]> = {},
): ReturnType<typeof render> {
  return render(
    <TopBar
      model={testTopBarModel()}
      info={testDatasetInfoModel()}
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
    fireEvent.change(within(panel).getByLabelText('Boundary limit'), {
      target: { value: '20000' },
    })
    fireEvent.click(within(panel).getByRole('switch', { name: 'Show debug info' }))

    expect(settings.onShowHoverTooltipsChange).toHaveBeenCalledWith(false)
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
})
