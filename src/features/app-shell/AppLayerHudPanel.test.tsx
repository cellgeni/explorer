import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { AppLayerHudPanel } from './AppLayerHudPanel'

type Props = ComponentProps<typeof AppLayerHudPanel>

function baseProps(overrides: Partial<Props> = {}): Props {
  return {
    active: true,
    appendDebugEvent: vi.fn(),
    autoContrastChannelIds: [],
    cellBoundaryOpacity: 1,
    cellFillOpacity: 1,
    cellLayerControlsVisible: true,
    controlIds: {
      cellBoundaryOpacityInputId: 'cell-boundary-opacity',
      cellBoundaryVisibilityInputId: 'cell-boundary-visibility',
      cellFillOpacityInputId: 'cell-fill-opacity',
      coordinateUnitInputId: 'coordinate-unit',
      hoverTooltipsInputId: 'hover-tooltips',
      imageOpacityInputId: 'image-opacity',
      measurementModeInputId: 'measurement-mode',
      measurementUnitInputId: 'measurement-unit',
      nucleusBoundaryVisibilityInputId: 'nucleus-boundary-visibility',
    },
    coordinateUnit: 'um',
    customLayerLoadState: { status: 'idle' },
    customLayers: [],
    customLayerOpacities: {},
    handleAutoContrast: vi.fn(),
    handleMagicLensLeave: vi.fn(),
    handleLoadCustomLayer: vi.fn(async () => true),
    handleRemoveCustomLayer: vi.fn(),
    imageLayerOpacity: 1,
    loadEnabled: true,
    measurementEnabled: false,
    measurementUnit: 'um',
    morphologyChannelSettings: [],
    morphologyChannels: [],
    showCellBoundaries: true,
    showNucleusBoundaries: true,
    showHoverTooltips: true,
    nucleusBoundaryControlsVisible: true,
    performanceBudget: {
      boundaryCellLimit: 50_000,
      maxConcurrentTileRequests: 4,
      overviewRenderCellLimit: 150_000,
      profile: 'balanced',
      telemetryEventLimit: 120,
      tileCacheMaxTiles: 120,
    },
    setCellBoundaryOpacity: vi.fn(),
    setCellFillOpacity: vi.fn(),
    setShowCellBoundaries: vi.fn(),
    setShowNucleusBoundaries: vi.fn(),
    setShowHoverTooltips: vi.fn(),
    setCoordinateUnit: vi.fn(),
    setCustomLayerOpacity: vi.fn(),
    setImageLayerOpacity: vi.fn(),
    setMagicLensActive: vi.fn(),
    setMeasurementEnabled: vi.fn(),
    setMeasurementResetKey: vi.fn(),
    setMeasurementUnit: vi.fn(),
    setRoiMode: vi.fn(),
    updateMorphologyChannel: vi.fn(),
    ...overrides,
  }
}

describe('AppLayerHudPanel', () => {
  it('normalizes opacity controls before updating app state', () => {
    const props = baseProps()

    render(<AppLayerHudPanel {...props} />)

    fireEvent.change(screen.getByRole('slider', { name: 'Dataset image opacity' }), {
      target: { value: '45' },
    })
    fireEvent.change(screen.getByRole('slider', { name: 'Cell fill opacity' }), {
      target: { value: '35' },
    })
    fireEvent.change(screen.getByRole('slider', { name: 'Cell boundary opacity' }), {
      target: { value: '25' },
    })

    expect(props.setImageLayerOpacity).toHaveBeenCalledWith(0.45)
    expect(props.setCellFillOpacity).toHaveBeenCalledWith(0.35)
    expect(props.setCellBoundaryOpacity).toHaveBeenCalledWith(0.25)
    expect(props.appendDebugEvent).toHaveBeenCalledWith('Dataset image opacity: 45%', {
      coalesceKey: 'image-opacity',
    })
    expect(props.appendDebugEvent).toHaveBeenCalledWith('Cell fill opacity: 35%', {
      coalesceKey: 'cell-fill-opacity',
    })
    expect(props.appendDebugEvent).toHaveBeenCalledWith('Cell boundary opacity: 25%', {
      coalesceKey: 'cell-boundary-opacity',
    })
  })

  it('logs independent boundary layer visibility changes', () => {
    const props = baseProps()

    render(<AppLayerHudPanel {...props} />)

    fireEvent.click(screen.getByLabelText('Cell boundaries'))
    fireEvent.click(screen.getByLabelText('Nucleus boundaries'))
    fireEvent.click(screen.getByLabelText('Hover tooltips'))

    expect(props.setShowCellBoundaries).toHaveBeenCalledWith(false)
    expect(props.setShowNucleusBoundaries).toHaveBeenCalledWith(false)
    expect(props.setShowHoverTooltips).toHaveBeenCalledWith(false)
    expect(props.appendDebugEvent).toHaveBeenCalledWith('Cell boundaries hidden', {
      coalesceKey: 'cell-boundaries-visible',
    })
    expect(props.appendDebugEvent).toHaveBeenCalledWith('Nucleus boundaries hidden', {
      coalesceKey: 'nucleus-boundaries-visible',
    })
    expect(props.appendDebugEvent).toHaveBeenCalledWith('Hover tooltips disabled', {
      coalesceKey: 'hover-tooltips-visible',
    })
  })

  it('coordinates measurement mode with ROI and magic lens state', () => {
    const props = baseProps()

    render(<AppLayerHudPanel {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'Distance measure' }))

    expect(props.setMeasurementEnabled).toHaveBeenCalledWith(true)
    expect(props.setRoiMode).toHaveBeenCalledWith('idle')
    expect(props.setMagicLensActive).toHaveBeenCalledWith(false)
    expect(props.handleMagicLensLeave).toHaveBeenCalledTimes(1)
    expect(props.appendDebugEvent).toHaveBeenCalledWith('Distance measure enabled', {
      coalesceKey: 'measurement-mode',
    })
  })

  it('ignores unchanged coordinate units and logs real unit changes', () => {
    const props = baseProps()

    render(<AppLayerHudPanel {...props} />)

    const coordinateGroup = screen.getByRole('group', { name: 'Mouse coordinates' })
    fireEvent.click(within(coordinateGroup).getByRole('button', { name: 'μm' }))
    fireEvent.click(within(coordinateGroup).getByRole('button', { name: 'px' }))

    expect(props.setCoordinateUnit).toHaveBeenCalledTimes(1)
    expect(props.setCoordinateUnit).toHaveBeenCalledWith('px')
    expect(props.appendDebugEvent).toHaveBeenCalledWith('Mouse coordinates: px', {
      coalesceKey: 'coordinate-unit',
    })
  })

  it('forwards custom layer load and remove actions', async () => {
    const props = baseProps({
      customLayers: [
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
      customLayerOpacities: {
        'https://example.test/remote.ome.tif': 0.6,
      },
    })

    render(<AppLayerHudPanel {...props} />)

    fireEvent.change(screen.getByRole('slider', { name: 'remote.ome.tif opacity' }), {
      target: { value: '35' },
    })
    fireEvent.change(screen.getByLabelText('Custom image URL'), {
      target: { value: 'https://example.test/new.ome.tif' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Load Layer' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove remote.ome.tif' }))

    expect(props.handleLoadCustomLayer).toHaveBeenCalledWith(
      'https://example.test/new.ome.tif',
    )
    expect(props.setCustomLayerOpacity).toHaveBeenCalledWith(
      'https://example.test/remote.ome.tif',
      0.35,
    )
    expect(props.appendDebugEvent).toHaveBeenCalledWith('Custom image opacity: 35%', {
      coalesceKey: 'custom-image-opacity:https://example.test/remote.ome.tif',
    })
    expect(props.handleRemoveCustomLayer).toHaveBeenCalledWith('custom-layer:1')
  })
})
