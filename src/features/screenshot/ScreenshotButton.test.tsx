import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { imagePixels, micrometers } from '../../data/coords'
import type { ImagePyramidLoader } from '../../data/imagePyramid'
import {
  testDatasetInfoModel,
  testDatasetLibraryModel,
  testTopBarModel,
  testViewSettingsModel,
} from '../../test/sectionModels'
import { TopBar } from '../shell/TopBar'
import { ScreenshotButton } from './ScreenshotButton'
import type { ScreenshotModel } from './screenshotModel'
import type { DrawScreenshotOptions, ScreenshotSnapshot } from './screenshotRun'
import { ScreenshotRunner, type ScreenshotRunnerOptions } from './screenshotRunner'

function loader(bytesPerTile: number | null): ImagePyramidLoader {
  return {
    url: 'https://example.test/dapi.ome.tif',
    channels: [{ id: 'dapi', name: 'DAPI' }],
    bestLevel: () => 0,
    tilesForBbox: () => [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ],
    tileBounds: () => ({
      minX: micrometers(0),
      maxX: micrometers(1),
      minY: micrometers(0),
      maxY: micrometers(1),
    }),
    tileSourceSize: () => ({ width: imagePixels(1), height: imagePixels(1) }),
    tileReadBytes: (_level: number, tiles: readonly unknown[]) =>
      Promise.resolve(bytesPerTile === null ? null : bytesPerTile * tiles.length),
  } as unknown as ImagePyramidLoader
}

function snapshot(
  overrides: Partial<ScreenshotSnapshot> = {},
  bytesPerTile: number | null = 1_000_000,
): ScreenshotSnapshot {
  const image = loader(bytesPerTile)
  return {
    viewState: { target: [0, 0, 0], zoom: 1, minZoom: -10, maxZoom: 10 },
    viewport: { width: 1500, height: 900 },
    image: {
      channels: [{ id: 'dapi', loader: image, enabled: true, color: [0, 0, 255] }],
      flatImage: null,
      opacity: 1,
    },
    layers: null,
    overlays: { scaleBar: null, axes: null, legend: [], selections: [] },
    cells: { inView: 1_414_155, onScreen: 250_000 },
    unitLabel: 'µm',
    maxConcurrentTileRequests: 4,
    viewChangedAt: -1000,
    ...overrides,
  }
}

function model(
  view: ScreenshotSnapshot | null,
  runnerOptions: ScreenshotRunnerOptions = {},
  overrides: Partial<ScreenshotModel> = {},
): ScreenshotModel {
  const runner = new ScreenshotRunner({ save: vi.fn(), now: () => 0, ...runnerOptions })
  if (view !== null) runner.connect(() => view)

  return {
    runner,
    available: true,
    include: { scaleBar: true, legend: false, axes: true, selections: true },
    expressionSampled: false,
    transcriptsAsDensity: false,
    loadingLabels: [],
    file: {
      fileName: 'sob23-screenshot.png',
      software: 'Spatial Omics Explorer',
      source: 'https://example.test/sob23',
      zPlane: null,
    },
    ...overrides,
  }
}

// Opens the popover and waits for its form, which loads on first use (O21).
async function open() {
  fireEvent.click(screen.getByRole('button', { name: 'Screenshot' }))
  const dialog = screen.getByRole('dialog', {
    name: 'Save the spatial view as a high-resolution PNG',
  })
  await waitFor(() => {
    expect(within(dialog).queryByText('Loading Screenshot…')).toBeNull()
  })
  return dialog
}

describe('Screenshot (plan 27, task H)', () => {
  it('sits beside Share in the top bar, and is off without a dataset', () => {
    const { rerender } = render(
      <TopBar
        model={testTopBarModel({ screenshot: model(snapshot()) })}
        info={testDatasetInfoModel()}
        library={testDatasetLibraryModel()}
        settings={testViewSettingsModel()}
        infoOpen={false}
        onInfoOpenChange={vi.fn()}
      />,
    )
    const screenshot = screen.getByRole('button', { name: 'Screenshot' })

    const share = screen.getByRole('button', { name: /Share/ })
    expect(
      screenshot.compareDocumentPosition(share) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(screenshot).toBeEnabled()

    rerender(
      <TopBar
        model={testTopBarModel({
          screenshot: model(snapshot(), {}, { available: false }),
        })}
        info={testDatasetInfoModel()}
        library={testDatasetLibraryModel()}
        settings={testViewSettingsModel()}
        infoOpen={false}
        onInfoOpenChange={vi.fn()}
        narrow
      />,
    )
    expect(screen.getByRole('button', { name: 'Screenshot' })).toBeDisabled()
  })

  it('gives the size, what it means in print, and the read (D3, D4)', async () => {
    render(<ScreenshotButton screenshot={model(snapshot())} iconOnly={false} />)
    const dialog = await open()

    expect(within(dialog).getByRole('button', { name: '2×' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(
      within(dialog).getByText(
        '3,000 × 1,800 px · 0.25 µm per pixel · 254 × 152 mm at 300 dpi',
      ),
    ).toBeInTheDocument()
    expect(
      await within(dialog).findByText('Reads 2 image tiles (2 MB).'),
    ).toBeInTheDocument()
  })

  it('turns off scales past the size limit (D10)', async () => {
    render(
      <ScreenshotButton
        screenshot={model(snapshot({ viewport: { width: 2100, height: 1200 } }))}
        iconOnly={false}
      />,
    )
    const dialog = await open()
    const eight = within(dialog).getByRole('button', { name: '8×' })

    // 16,800 px wide.
    expect(eight).toBeDisabled()
    expect(eight).toHaveAttribute('title', 'Over 16,384 px on a side: too large to draw')
    expect(within(dialog).getByRole('button', { name: '4×' })).toBeEnabled()
  })

  it('notes the cells the screen samples and what is loading (D5, D7)', async () => {
    render(
      <ScreenshotButton
        screenshot={model(snapshot(), {}, { loadingLabels: ['Loading cell boundaries'] })}
        iconOnly
      />,
    )
    const dialog = await open()

    expect(
      within(dialog).getByText(
        'Draws all 1,414,155 cells in view; the screen shows about 250,000.',
      ),
    ).toBeInTheDocument()
    expect(
      within(dialog).getByText(/Still loading: Loading cell boundaries/),
    ).toBeInTheDocument()
  })

  it('starts the screenshot with the options chosen', async () => {
    const draw = vi.fn().mockResolvedValue(new Blob())
    const save = vi.fn()
    render(
      <ScreenshotButton
        screenshot={model(snapshot(), { draw, save })}
        iconOnly={false}
      />,
    )
    const dialog = await open()

    fireEvent.click(within(dialog).getByRole('button', { name: '4×' }))
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Legend' }))
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Axes' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'White' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save PNG' }))

    await vi.waitFor(() => {
      expect(save).toHaveBeenCalledWith('sob23-screenshot.png', expect.any(Blob))
    })
    expect(draw.mock.calls[0]?.[1]).toEqual({
      scale: 4,
      dpi: 300,
      include: { scaleBar: true, legend: true, axes: false, selections: true },
      background: 'white',
    })
    expect(
      await within(dialog).findByText('Saved sob23-screenshot.png.'),
    ).toBeInTheDocument()
  })

  it('asks before reading more than 512 MiB of tiles', async () => {
    const draw = vi.fn().mockResolvedValue(new Blob())
    render(
      <ScreenshotButton
        screenshot={model(snapshot({}, 400 * 1024 ** 2), { draw })}
        iconOnly={false}
      />,
    )
    const dialog = await open()
    await within(dialog).findByText(/Reads 2 image tiles \(839 MB\)/)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save PNG' }))
    expect(draw).not.toHaveBeenCalled()
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'This reads 839 MB of image tiles',
    )

    fireEvent.click(within(dialog).getByRole('button', { name: 'Read 839 MB and save' }))
    await vi.waitFor(() => {
      expect(draw).toHaveBeenCalledOnce()
    })
  })

  it('shows progress with Cancel, then Retry for a tile it could not read', async () => {
    let fail: (error: Error) => void = () => undefined
    let progress: NonNullable<DrawScreenshotOptions['onProgress']> = () => undefined
    const draw = vi.fn(
      (
        _view: ScreenshotSnapshot,
        _options: unknown,
        _file: unknown,
        run: DrawScreenshotOptions,
      ) =>
        new Promise<Blob>((_resolve, reject) => {
          fail = reject
          if (run.onProgress !== undefined) progress = run.onProgress
        }),
    )
    render(<ScreenshotButton screenshot={model(snapshot(), { draw })} iconOnly={false} />)
    const dialog = await open()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save PNG' }))
    await vi.waitFor(() => {
      expect(draw).toHaveBeenCalled()
    })
    act(() => {
      progress({ stage: 'image', done: 1, total: 4 })
    })

    expect(within(dialog).getByRole('status')).toHaveTextContent(
      'Reading image tiles · 25%',
    )
    expect(within(dialog).getByRole('button', { name: 'Save PNG' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeEnabled()

    const { ScreenshotImageError } = await import('./screenshotImage')
    await act(async () => {
      fail(new ScreenshotImageError('DAPI', new Error('503')))
      await Promise.resolve()
    })

    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'The screenshot failed. A tile of DAPI could not be read: 503',
    )
    expect(within(dialog).getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('says when the view has not drawn yet', async () => {
    render(<ScreenshotButton screenshot={model(null)} iconOnly={false} />)
    const dialog = await open()

    expect(within(dialog).getByText(/The view has not drawn yet/)).toBeInTheDocument()
  })
})
