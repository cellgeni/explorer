import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LayerHudPanel } from './LayerHudPanel'

describe('LayerHudPanel', () => {
  it('renders layer controls and forwards display setting updates', () => {
    const onImageLayerOpacityPercentChange = vi.fn()
    const onCellFillOpacityPercentChange = vi.fn()
    const onCellBoundaryOpacityPercentChange = vi.fn()
    const onCoordinateUnitChange = vi.fn()
    const onMeasurementEnabledChange = vi.fn()
    const onMeasurementUnitChange = vi.fn()
    const onClearMeasurement = vi.fn()

    render(
      <LayerHudPanel
        active
        scaffoldDeckLayerCount={3}
        bundledDeckVersion="9.3.2"
        performanceBudget={{
          profile: 'balanced',
          overviewRenderCellLimit: 150000,
          boundaryCellLimit: 50000,
          maxConcurrentTileRequests: 4,
          tileCacheMaxTiles: 120,
          telemetryEventLimit: 120,
        }}
        imageOpacityInputId="image-opacity"
        cellFillOpacityInputId="cell-fill-opacity"
        cellBoundaryOpacityInputId="cell-boundary-opacity"
        coordinateUnitInputId="coordinate-unit"
        measurementModeInputId="measurement-mode"
        measurementUnitInputId="measurement-unit"
        customLayerLoadState={{ status: 'idle' }}
        customLayers={[]}
        loadEnabled
        imageLayerOpacity={0.8}
        cellFillOpacity={0.6}
        cellBoundaryOpacity={0.4}
        coordinateUnit="um"
        measurementEnabled={false}
        measurementUnit="um"
        morphologyChannels={[]}
        morphologyChannelSettings={[]}
        autoContrastChannelIds={[]}
        onImageLayerOpacityPercentChange={onImageLayerOpacityPercentChange}
        onCellFillOpacityPercentChange={onCellFillOpacityPercentChange}
        onCellBoundaryOpacityPercentChange={onCellBoundaryOpacityPercentChange}
        onCoordinateUnitChange={onCoordinateUnitChange}
        onMeasurementEnabledChange={onMeasurementEnabledChange}
        onMeasurementUnitChange={onMeasurementUnitChange}
        onClearMeasurement={onClearMeasurement}
        onAutoContrast={vi.fn()}
        onLoadCustomLayer={vi.fn(async () => true)}
        onRemoveCustomLayer={vi.fn()}
        onUpdateMorphologyChannel={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByLabelText('Image opacity'), { target: { value: '45' } })
    fireEvent.change(screen.getByLabelText('Cell fill opacity'), {
      target: { value: '55' },
    })
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

    expect(onImageLayerOpacityPercentChange).toHaveBeenCalledWith(45)
    expect(onCellFillOpacityPercentChange).toHaveBeenCalledWith(55)
    expect(onCellBoundaryOpacityPercentChange).toHaveBeenCalledWith(65)
    expect(onCoordinateUnitChange).toHaveBeenCalledWith('px')
    expect(onMeasurementEnabledChange).toHaveBeenCalledWith(true)
    expect(onMeasurementUnitChange).toHaveBeenCalledWith('px')
    expect(onClearMeasurement).toHaveBeenCalledTimes(1)
  })
})
