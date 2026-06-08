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
    controlIds: {
      cellBoundaryOpacityInputId: 'cell-boundary-opacity',
      cellFillOpacityInputId: 'cell-fill-opacity',
      coordinateUnitInputId: 'coordinate-unit',
      imageOpacityInputId: 'image-opacity',
      measurementModeInputId: 'measurement-mode',
      measurementUnitInputId: 'measurement-unit',
    },
    coordinateUnit: 'um',
    handleAutoContrast: vi.fn(),
    handleMagicLensLeave: vi.fn(),
    imageLayerOpacity: 1,
    measurementEnabled: false,
    measurementUnit: 'um',
    morphologyChannelSettings: [],
    morphologyChannels: [],
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
    setCoordinateUnit: vi.fn(),
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

    fireEvent.change(screen.getByRole('slider', { name: 'Image opacity' }), {
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
    expect(props.appendDebugEvent).toHaveBeenCalledWith('Image opacity: 45%', {
      coalesceKey: 'image-opacity',
    })
    expect(props.appendDebugEvent).toHaveBeenCalledWith('Cell fill opacity: 35%', {
      coalesceKey: 'cell-fill-opacity',
    })
    expect(props.appendDebugEvent).toHaveBeenCalledWith('Cell boundary opacity: 25%', {
      coalesceKey: 'cell-boundary-opacity',
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
})
