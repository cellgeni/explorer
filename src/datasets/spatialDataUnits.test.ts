import { describe, expect, it } from 'vitest'
import {
  declaredSpatialDataUnits,
  estimateUnitsFromAreas,
  estimateUnitsFromVisiumHdBins,
  estimateUnitsFromVisiumSpots,
  overrideSpatialDataUnits,
} from './spatialDataUnits'

describe('SpatialData units', () => {
  it('reads physical axis units declared for the coordinate system', () => {
    const attrs = {
      coordinateTransformations: [
        {
          type: 'identity',
          input: { name: 'xy', axes: [{ name: 'x' }, { name: 'y' }] },
          output: {
            name: 'aligned',
            axes: [
              { name: 'x', unit: 'nanometer' },
              { name: 'y', unit: 'nanometer' },
            ],
          },
        },
        {
          type: 'identity',
          input: { name: 'xy', axes: [{ name: 'x' }, { name: 'y' }] },
          output: {
            name: 'global',
            axes: [
              { name: 'x', unit: 'unit' },
              { name: 'y', unit: 'unit' },
            ],
          },
        },
      ],
    }

    expect(declaredSpatialDataUnits([attrs], 'aligned')).toEqual({
      micrometersPerUnit: 0.001,
      source: 'declared',
      detail: 'axis unit nanometer',
    })
    expect(declaredSpatialDataUnits([attrs], 'global')).toBeNull()
  })

  it('estimates the scale from cell areas in µm² and in coordinate units²', () => {
    // Xenium morphology pixels: 0.2125 µm, so 1 µm² = 22.14 px².
    const pairs = Array.from({ length: 40 }, (_value, index) => {
      const micrometersSquared = 40 + index
      return { micrometersSquared, unitsSquared: micrometersSquared / 0.2125 ** 2 }
    })

    expect(estimateUnitsFromAreas(pairs, 'cell_area')?.micrometersPerUnit).toBeCloseTo(
      0.2125,
      6,
    )
    expect(estimateUnitsFromAreas(pairs.slice(0, 5), 'cell_area')).toBeNull()
  })

  it('estimates the scale from the Visium 100 µm spot pitch', () => {
    // Hexagonal lattice with 182.7 units between neighbours.
    const pitch = 182.7
    const centers = Array.from({ length: 200 }, (_value, index) => {
      const row = Math.floor(index / 20)
      const col = index % 20
      return {
        x: col * pitch + (row % 2) * (pitch / 2),
        y: row * pitch * (Math.sqrt(3) / 2),
      }
    })

    expect(estimateUnitsFromVisiumSpots(centers)?.micrometersPerUnit).toBeCloseTo(
      100 / pitch,
      6,
    )
  })

  it('estimates the scale from Visium HD bin names', () => {
    const areas = Array.from({ length: 30 }, () => 16 * 16)

    expect(
      estimateUnitsFromVisiumHdBins('sample_square_008um', areas)?.micrometersPerUnit,
    ).toBe(0.5)
    expect(estimateUnitsFromVisiumHdBins('cell_boundaries', areas)).toBeNull()
  })

  it('accepts only positive overrides', () => {
    expect(overrideSpatialDataUnits(0.5)?.source).toBe('override')
    expect(overrideSpatialDataUnits(0)).toBeNull()
    expect(overrideSpatialDataUnits(Number.NaN)).toBeNull()
  })
})
