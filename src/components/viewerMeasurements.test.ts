import { describe, expect, it } from 'vitest'
import { micrometers } from '../data/coords'
import {
  formatCoordinateValue,
  hasMinimumMeasurementDistance,
  measurementOverlayModel,
  rawDataPointToScreen,
  safeMicrometersPerPixel,
  scaleBarModel,
} from './viewerMeasurements'

const viewState = {
  target: [50, -25, 0] as [number, number, number],
  zoom: 0,
  minZoom: -8,
  maxZoom: 8,
}

const viewport = { width: 200, height: 100 }

describe('viewerMeasurements', () => {
  it('projects raw data points to screen space', () => {
    expect(
      rawDataPointToScreen(
        { x: micrometers(50), y: micrometers(-25) },
        viewState,
        viewport,
      ),
    ).toEqual({
      x: 100,
      y: 0,
    })
  })

  it('builds measurement overlay models with formatted labels', () => {
    const model = measurementOverlayModel(
      {
        start: { x: micrometers(0), y: micrometers(0) },
        end: { x: micrometers(3), y: micrometers(4) },
        isDraft: false,
      },
      viewState,
      viewport,
      'um',
      0.5,
    )

    expect(model.label).toBe('5 μm')
    expect(model.isDraft).toBe(false)
    expect(model.labelStyle.left).toBeGreaterThanOrEqual(8)
  })

  it('models scale bars and measurement thresholds', () => {
    expect(scaleBarModel(viewState, viewport, 'um', 0.5)).toMatchObject({
      label: '50 μm',
      widthPixels: 50,
    })
    expect(
      hasMinimumMeasurementDistance(
        {
          start: { x: micrometers(0), y: micrometers(0) },
          end: { x: micrometers(2), y: micrometers(0) },
        },
        viewState,
      ),
    ).toBe(false)
  })

  it('normalizes pixel size and coordinate formatting', () => {
    expect(safeMicrometersPerPixel(0)).toBe(0.2125)
    expect(formatCoordinateValue(1.234)).toBe('1.23')
    expect(formatCoordinateValue(12.34)).toBe('12.3')
  })
})
