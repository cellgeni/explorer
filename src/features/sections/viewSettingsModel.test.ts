import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useViewSettingsModel, type ViewSettingsModelInput } from './viewSettingsModel'

function input(overrides: Partial<ViewSettingsModelInput> = {}): ViewSettingsModelInput {
  return {
    appendDebugEvent: vi.fn(),
    coordinateUnit: 'um',
    handleMagicLensLeave: vi.fn(),
    measurementEnabled: false,
    measurementUnit: 'um',
    setCoordinateUnit: vi.fn(),
    setMeasurementEnabled: vi.fn(),
    setMeasurementResetKey: vi.fn(),
    setMeasurementUnit: vi.fn(),
    setShowAxes: vi.fn(),
    setShowHoverTooltips: vi.fn(),
    setShowMinimap: vi.fn(),
    showAxes: false,
    showHoverTooltips: true,
    showMinimap: true,
    ...overrides,
  }
}

describe('useViewSettingsModel', () => {
  it('logs hover tooltip changes and ignores unchanged ones', () => {
    const options = input()
    const { result } = renderHook(() => useViewSettingsModel(options))

    result.current.onShowHoverTooltipsChange(true)
    result.current.onShowHoverTooltipsChange(false)

    expect(options.setShowHoverTooltips).toHaveBeenCalledTimes(1)
    expect(options.setShowHoverTooltips).toHaveBeenCalledWith(false)
    expect(options.appendDebugEvent).toHaveBeenCalledWith('Hover tooltips disabled', {
      coalesceKey: 'hover-tooltips-visible',
    })
  })

  it('ignores unchanged coordinate units and logs real unit changes', () => {
    const options = input()
    const { result } = renderHook(() => useViewSettingsModel(options))

    result.current.onCoordinateUnitChange('um')
    result.current.onCoordinateUnitChange('px')

    expect(options.setCoordinateUnit).toHaveBeenCalledTimes(1)
    expect(options.setCoordinateUnit).toHaveBeenCalledWith('px')
    expect(options.appendDebugEvent).toHaveBeenCalledWith('Mouse coordinates: px', {
      coalesceKey: 'coordinate-unit',
    })
  })

  it('turns on measuring and leaves the magic lens', () => {
    const options = input()
    const { result } = renderHook(() => useViewSettingsModel(options))

    result.current.measure.onEnabledChange(true)

    expect(options.setMeasurementEnabled).toHaveBeenCalledWith(true)
    expect(options.handleMagicLensLeave).toHaveBeenCalledTimes(1)
    expect(options.setMeasurementResetKey).not.toHaveBeenCalled()
    expect(options.appendDebugEvent).toHaveBeenCalledWith('Distance measure enabled', {
      coalesceKey: 'measurement-mode',
    })
  })

  it('clears the line when measuring stops or is cleared', () => {
    const options = input({ measurementEnabled: true })
    const { result } = renderHook(() => useViewSettingsModel(options))

    result.current.measure.onEnabledChange(false)
    result.current.measure.onClear()
    result.current.measure.onUnitChange('px')

    expect(options.handleMagicLensLeave).not.toHaveBeenCalled()
    expect(options.setMeasurementResetKey).toHaveBeenCalledTimes(2)
    expect(options.setMeasurementUnit).toHaveBeenCalledWith('px')
    expect(options.appendDebugEvent).toHaveBeenCalledWith('Distance measure cleared', {
      coalesceKey: 'measurement-clear',
    })
    expect(options.appendDebugEvent).toHaveBeenCalledWith('Measure unit: px', {
      coalesceKey: 'measurement-unit',
    })
  })

  it('shows and hides the minimap, logging only changes', () => {
    const options = input()
    const { result } = renderHook(() => useViewSettingsModel(options))

    result.current.onShowMinimapChange(true)
    result.current.onShowMinimapChange(false)

    expect(options.setShowMinimap).toHaveBeenCalledTimes(1)
    expect(options.setShowMinimap).toHaveBeenCalledWith(false)
    expect(options.appendDebugEvent).toHaveBeenCalledWith('Minimap hidden', {
      coalesceKey: 'minimap-visible',
    })
  })

  it('shows and hides the axes, logging only changes', () => {
    const options = input()
    const { result } = renderHook(() => useViewSettingsModel(options))

    result.current.onShowAxesChange(false)
    result.current.onShowAxesChange(true)

    expect(options.setShowAxes).toHaveBeenCalledTimes(1)
    expect(options.setShowAxes).toHaveBeenCalledWith(true)
    expect(options.appendDebugEvent).toHaveBeenCalledWith('Axes shown', {
      coalesceKey: 'axes-visible',
    })
  })
})
