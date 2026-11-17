import { describe, expect, it } from 'vitest'
import {
  applyAffine,
  axisPermutingAffine,
  readElementCoordinateTransforms,
  transformationToAffine,
} from './spatialDataTransforms'

const XY = { name: 'xy', axes: [{ name: 'x' }, { name: 'y' }] }
const CYX = { name: 'cyx', axes: [{ name: 'c' }, { name: 'y' }, { name: 'x' }] }

describe('SpatialData coordinate transformations', () => {
  it('maps scale and translation vectors by declared input axes', () => {
    expect(
      transformationToAffine({ type: 'scale', scale: [1, 0.5, 0.25], input: CYX }, []),
    ).toEqual({ a: 0.25, b: 0, c: 0, d: 0, e: 0.5, f: 0 })
    expect(
      transformationToAffine({ type: 'translation', translation: [3, 4], input: XY }, []),
    ).toEqual({ a: 1, b: 0, c: 3, d: 0, e: 1, f: 4 })
  })

  it('composes sequences in order and reads affine matrices by axis name', () => {
    const sequence = transformationToAffine(
      {
        type: 'sequence',
        input: XY,
        output: { name: 'global', axes: XY.axes },
        transformations: [
          { type: 'scale', scale: [2, 2], input: XY, output: XY },
          { type: 'translation', translation: [10, 20], input: XY, output: XY },
        ],
      },
      [],
    )

    expect(applyAffine(sequence, 1, 1)).toEqual({ x: 12, y: 22 })

    const affine = transformationToAffine(
      {
        type: 'affine',
        input: CYX,
        output: { name: 'global', axes: CYX.axes },
        affine: [
          [1, 0, 0, 0],
          [0, 2, 0, 5],
          [0, 0, 3, 7],
          [0, 0, 0, 1],
        ],
      },
      [],
    )

    expect(affine).toEqual({ a: 3, b: 0, c: 7, d: 0, e: 2, f: 5 })
  })

  it('swaps axes for mapAxis transformations', () => {
    const affine = transformationToAffine(
      { type: 'mapAxis', mapAxis: { x: 'y', y: 'x' }, input: XY },
      [],
    )

    expect(applyAffine(affine, 1, 2)).toEqual({ x: 2, y: 1 })
  })

  it('reads per-coordinate-system transforms from images and shapes', () => {
    expect(
      readElementCoordinateTransforms({
        multiscales: [
          {
            coordinateTransformations: [
              { type: 'identity', input: CYX, output: { name: 'global' } },
              {
                type: 'scale',
                scale: [1, 0.1, 0.1],
                input: CYX,
                output: { name: 'downscaled' },
              },
            ],
          },
        ],
      }),
    ).toEqual([
      { coordinateSystem: 'global', affine: { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 } },
      {
        coordinateSystem: 'downscaled',
        affine: { a: 0.1, b: 0, c: 0, d: 0, e: 0.1, f: 0 },
      },
    ])

    expect(
      readElementCoordinateTransforms({
        coordinateTransformations: [
          { type: 'scale', scale: [2, 3], input: XY, output: { name: 'global' } },
        ],
      }),
    ).toEqual([
      { coordinateSystem: 'global', affine: { a: 2, b: 0, c: 0, d: 0, e: 3, f: 0 } },
    ])
  })

  it('skips coordinate systems whose transformation is not planar', () => {
    expect(
      readElementCoordinateTransforms({
        coordinateTransformations: [
          { type: 'byDimension', input: XY, output: { name: 'unsupported' } },
          { type: 'identity', input: XY, output: { name: 'global' } },
        ],
      }).map((transform) => transform.coordinateSystem),
    ).toEqual(['global'])
  })

  it('keeps flips and axis swaps, and drops negligible turns', () => {
    // STHELAR bone marrow `he`: input (c, y, x), output (c, x, y), an x/y swap
    // and flip with a 1.9e-5 rad registration turn.
    const he = transformationToAffine(
      {
        type: 'affine',
        input: CYX,
        output: { name: 'global', axes: [{ name: 'c' }, { name: 'x' }, { name: 'y' }] },
        affine: [
          [1, 0, 0, 0],
          [0, 1.288078013016111, -2.44257565353962e-5, -71.74741989665199],
          [0, -2.44257565353962e-5, -1.288078013016111, 15558.932913935298],
        ],
      },
      [],
    )

    expect(axisPermutingAffine(he)).toEqual({
      a: 0,
      b: 1.288078013016111,
      c: -71.74741989665199,
      d: -1.288078013016111,
      e: 0,
      f: 15558.932913935298,
    })
    expect(axisPermutingAffine({ a: -2, b: 0, c: 5, d: 0, e: 3, f: 0 })).toEqual({
      a: -2,
      b: 0,
      c: 5,
      d: 0,
      e: 3,
      f: 0,
    })
    // 45° and a shear stay skipped.
    expect(
      axisPermutingAffine({
        a: Math.SQRT1_2,
        b: -Math.SQRT1_2,
        c: 0,
        d: Math.SQRT1_2,
        e: Math.SQRT1_2,
        f: 0,
      }),
    ).toBeNull()
    expect(axisPermutingAffine({ a: 1, b: 0.01, c: 0, d: 0, e: 1, f: 0 })).toBeNull()
  })
})
