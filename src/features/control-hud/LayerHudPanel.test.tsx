import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  testCellsSectionModel,
  testDatasetInfoModel,
  testImageSectionModel,
  testViewSettingsModel,
} from '../../test/sectionModels'
import { LayerHudPanel } from './LayerHudPanel'

describe('LayerHudPanel', () => {
  it('renders layer controls and forwards display setting updates', () => {
    const image = testImageSectionModel({
      opacity: 0.8,
      zStack: { sizeZ: 15, zPlane: 7, micrometersPerPlane: 3, openPlane: vi.fn() },
      customLayers: {
        layers: [
          {
            id: 'custom-layer:1',
            label: 'remote.ome.tif',
            image: {
              url: 'https://example.test/remote.ome.tif',
              loader: {},
              channels: [],
              channelLoaders: [],
            } as never,
            channels: [],
          },
        ],
        opacities: { 'https://example.test/remote.ome.tif': 0.6 },
      },
    })
    const cells = testCellsSectionModel({
      appearance: { fillOpacity: 0.6, boundaryOpacity: 0.4 },
    })
    const settings = testViewSettingsModel()

    render(
      <LayerHudPanel
        active
        image={image}
        cells={cells}
        settings={settings}
        info={testDatasetInfoModel()}
      />,
    )

    fireEvent.change(screen.getByLabelText('Dataset image opacity'), {
      target: { value: '45' },
    })
    expect(screen.getByText('8 / 15 · 21 µm')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Z plane'), {
      target: { value: '9' },
    })
    fireEvent.change(screen.getByLabelText('remote.ome.tif opacity'), {
      target: { value: '35' },
    })
    fireEvent.change(screen.getByLabelText('Cell fill opacity'), {
      target: { value: '55' },
    })
    fireEvent.click(screen.getByLabelText('Cell boundaries'))
    fireEvent.click(screen.getByLabelText('Nucleus boundaries'))
    fireEvent.click(screen.getByLabelText('Hover tooltips'))
    fireEvent.change(screen.getByLabelText('Cell boundary opacity'), {
      target: { value: '65' },
    })
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Mouse coordinates' })).getByRole(
        'button',
        { name: 'px' },
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Distance measure' }))
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Measure unit' })).getByRole('button', {
        name: 'px',
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Clear Measurement' }))
    fireEvent.change(screen.getByLabelText('Custom image URL'), {
      target: { value: ' https://example.test/new.ome.tif ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Load Layer' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove remote.ome.tif' }))

    expect(image.onOpacityPercentChange).toHaveBeenCalledWith(45)
    expect(image.onZPlaneChange).toHaveBeenCalledWith(9)
    expect(image.customLayers.onOpacityPercentChange).toHaveBeenCalledWith(
      'https://example.test/remote.ome.tif',
      35,
    )
    expect(cells.appearance.onFillOpacityPercentChange).toHaveBeenCalledWith(55)
    expect(cells.appearance.onShowCellBoundariesChange).toHaveBeenCalledWith(false)
    expect(cells.appearance.onShowNucleusBoundariesChange).toHaveBeenCalledWith(false)
    expect(settings.onShowHoverTooltipsChange).toHaveBeenCalledWith(false)
    expect(cells.appearance.onBoundaryOpacityPercentChange).toHaveBeenCalledWith(65)
    expect(settings.onCoordinateUnitChange).toHaveBeenCalledWith('px')
    expect(settings.measure.onEnabledChange).toHaveBeenCalledWith(true)
    expect(settings.measure.onUnitChange).toHaveBeenCalledWith('px')
    expect(settings.measure.onClear).toHaveBeenCalledTimes(1)
    expect(image.customLayers.onLoad).toHaveBeenCalledWith(
      'https://example.test/new.ome.tif',
    )
    expect(image.customLayers.onRemove).toHaveBeenCalledWith('custom-layer:1')
  })

  it('hides cell controls for an image and shows the layer stack in debug mode', () => {
    render(
      <LayerHudPanel
        active
        image={testImageSectionModel()}
        cells={testCellsSectionModel({ appearance: { available: false } })}
        settings={testViewSettingsModel()}
        info={testDatasetInfoModel({
          diagnostics: {
            layerStack: {
              deckLayerCount: 3,
              deckVersion: '9.3.2',
              performanceBudget: {
                profile: 'balanced',
                overviewRenderCellLimit: 150_000,
                boundaryCellLimit: 50_000,
                maxConcurrentTileRequests: 4,
                tileCacheMaxTiles: 120,
                telemetryEventLimit: 120,
              },
            },
          },
        })}
      />,
    )

    expect(screen.queryByLabelText('Cell boundaries')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Cell fill opacity')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Hover tooltips')).toBeInTheDocument()
    expect(screen.getByText('3 Deck Layer - deck.gl 9.3.2')).toBeInTheDocument()
    expect(
      screen.getByText('Budget balanced - 150,000 cells - 4 tile requests'),
    ).toBeInTheDocument()
  })
})
