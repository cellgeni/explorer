import { describe, expect, it } from 'vitest'
import { micrometers } from '../data/coords'
import {
  deriveNestedGridBasis,
  fitGridBasis,
  gridCellCenter,
  gridCellCorners,
  signedPolygonArea,
} from './spatialGrid'
import type { SpatialGridBasis } from './spatialDataset'

describe('spatial grid geometry', () => {
  it('treats axis-aligned squares as a degenerate affine grid', () => {
    const basis: SpatialGridBasis = {
      origin: { x: micrometers(0), y: micrometers(0) },
      rowStep: { x: micrometers(10), y: micrometers(0) },
      colStep: { x: micrometers(0), y: micrometers(10) },
    }

    expect(gridCellCenter(basis, 1, 2)).toEqual({
      x: micrometers(10),
      y: micrometers(20),
    })
    expect(gridCellCorners(basis, 0, 0)).toEqual([
      { x: micrometers(-5), y: micrometers(-5) },
      { x: micrometers(-5), y: micrometers(5) },
      { x: micrometers(5), y: micrometers(5) },
      { x: micrometers(5), y: micrometers(-5) },
    ])
  })

  it('can normalize polygon winding for left- or right-handed bases', () => {
    const basis: SpatialGridBasis = {
      origin: { x: micrometers(0), y: micrometers(0) },
      rowStep: { x: micrometers(0), y: micrometers(10) },
      colStep: { x: micrometers(10), y: micrometers(0) },
    }

    const clockwise = gridCellCorners(basis, 0, 0, { winding: 'clockwise' })
    const counterclockwise = gridCellCorners(basis, 0, 0, {
      winding: 'counterclockwise',
    })

    expect(signedPolygonArea(clockwise)).toBeLessThan(0)
    expect(signedPolygonArea(counterclockwise)).toBeGreaterThan(0)
  })

  it('fits an affine basis from array row and column samples', () => {
    const samples = [
      { row: 0, col: 0, point: { x: micrometers(100), y: micrometers(200) } },
      { row: 1, col: 0, point: { x: micrometers(110), y: micrometers(201) } },
      { row: 0, col: 1, point: { x: micrometers(98), y: micrometers(208) } },
      { row: 2, col: 3, point: { x: micrometers(114), y: micrometers(226) } },
    ]

    const basis = fitGridBasis(samples)

    expect(basis.origin.x).toBeCloseTo(100)
    expect(basis.origin.y).toBeCloseTo(200)
    expect(basis.rowStep.x).toBeCloseTo(10)
    expect(basis.rowStep.y).toBeCloseTo(1)
    expect(basis.colStep.x).toBeCloseTo(-2)
    expect(basis.colStep.y).toBeCloseTo(8)
  })

  it('derives nested coarser grid bases from a finest-tier basis', () => {
    const finestBasis: SpatialGridBasis = {
      origin: { x: micrometers(0), y: micrometers(0) },
      rowStep: { x: micrometers(2), y: micrometers(0) },
      colStep: { x: micrometers(0), y: micrometers(2) },
    }

    const coarserBasis = deriveNestedGridBasis(finestBasis, 4)

    expect(coarserBasis.origin).toEqual({
      x: micrometers(3),
      y: micrometers(3),
    })
    expect(coarserBasis.rowStep).toEqual({
      x: micrometers(8),
      y: micrometers(0),
    })
    expect(coarserBasis.colStep).toEqual({
      x: micrometers(0),
      y: micrometers(8),
    })
  })
})
