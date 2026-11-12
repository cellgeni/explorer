import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { invertAffine } from './spatialDataLabels'
import {
  applyAffine,
  composeAffine,
  IDENTITY_AFFINE,
  type Affine2D,
} from './spatialDataTransforms'

// Ranges that fit SpatialData elements: coordinates and translations up to
// about 1e5, scales from 0.05 to 20, and the rotations, small shears, flips
// and mild anisotropy that image registration produces. These keep every
// matrix invertible with a condition number below about 20.
const MAX_COORDINATE = 1e5

function finite(min: number, max: number): fc.Arbitrary<number> {
  return fc.double({ min, max, noNaN: true })
}

function logUniform(min: number, max: number): fc.Arbitrary<number> {
  return finite(Math.log(min), Math.log(max)).map((value) =>
    Math.min(max, Math.max(min, Math.exp(value))),
  )
}

// rotation · shear · scale · (optional flip), then a translation.
const affineArb: fc.Arbitrary<Affine2D> = fc
  .record({
    angle: finite(-Math.PI, Math.PI),
    scale: logUniform(0.05, 20),
    aspect: logUniform(0.5, 2),
    shear: finite(-0.5, 0.5),
    flip: fc.boolean(),
    c: finite(-MAX_COORDINATE, MAX_COORDINATE),
    f: finite(-MAX_COORDINATE, MAX_COORDINATE),
  })
  .map(({ angle, scale, aspect, shear, flip, c, f }) => {
    const sx = scale * Math.sqrt(aspect) * (flip ? -1 : 1)
    const sy = scale / Math.sqrt(aspect)
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    // [cos -sin; sin cos] · [1 shear; 0 1] · [sx 0; 0 sy]
    return {
      a: cos * sx,
      b: (cos * shear - sin) * sy,
      c,
      d: sin * sx,
      e: (sin * shear + cos) * sy,
      f,
    }
  })

const pointArb = fc.record({
  x: finite(-MAX_COORDINATE, MAX_COORDINATE),
  y: finite(-MAX_COORDINATE, MAX_COORDINATE),
})

// Frobenius condition number; for a 2 × 2 matrix ‖A⁻¹‖F = ‖A‖F / |det A|.
function conditionNumber(affine: Affine2D): number {
  const normSquared = affine.a ** 2 + affine.b ** 2 + affine.d ** 2 + affine.e ** 2
  return normSquared / Math.abs(affine.a * affine.e - affine.b * affine.d)
}

// The largest value an affine works with for this point: the point itself,
// its translation and the linear part's output.
function magnitude(affine: Affine2D, x: number, y: number): number {
  const linear = Math.hypot(affine.a, affine.b, affine.d, affine.e)
  return Math.max(
    1,
    Math.abs(x),
    Math.abs(y),
    Math.abs(affine.c),
    Math.abs(affine.f),
    linear * Math.hypot(x, y),
  )
}

function expectNear(
  actual: { readonly x: number; readonly y: number },
  expected: { readonly x: number; readonly y: number },
  tolerance: number,
  label: string,
): void {
  const error = Math.hypot(actual.x - expected.x, actual.y - expected.y)

  if (!(error <= tolerance)) {
    throw new Error(
      `${label}: (${actual.x}, ${actual.y}) is ${error} from (${expected.x}, ${expected.y}); allowed ${tolerance}`,
    )
  }
}

// About 450 times double-precision epsilon, scaled by the size of the values
// involved and, for an inverse, by how much the matrix amplifies error.
const RELATIVE_TOLERANCE = 1e-13

describe('affine transforms (property)', () => {
  it('generates well-conditioned matrices', () => {
    fc.assert(
      fc.property(affineArb, (affine) => {
        expect(conditionNumber(affine)).toBeLessThan(20)
      }),
    )
  })

  it('returns the point after applying an affine and then its inverse', () => {
    fc.assert(
      fc.property(affineArb, pointArb, (affine, { x, y }) => {
        const inverse = invertAffine(affine)
        const mapped = applyAffine(affine, x, y)
        const back = applyAffine(inverse, mapped.x, mapped.y)
        const tolerance =
          RELATIVE_TOLERANCE * conditionNumber(affine) * magnitude(affine, x, y)

        expectNear(back, { x, y }, tolerance, 'A⁻¹(A(p))')

        const forward = applyAffine(affine, ...xy(applyAffine(inverse, x, y)))
        expectNear(forward, { x, y }, tolerance, 'A(A⁻¹(p))')
      }),
    )
  })

  it('composes an affine with its inverse to the identity', () => {
    fc.assert(
      fc.property(affineArb, (affine) => {
        const identity = composeAffine(invertAffine(affine), affine)
        const linearTolerance = RELATIVE_TOLERANCE * conditionNumber(affine)
        const translationTolerance = linearTolerance * magnitude(affine, 0, 0)

        expect(Math.abs(identity.a - 1)).toBeLessThanOrEqual(linearTolerance)
        expect(Math.abs(identity.b)).toBeLessThanOrEqual(linearTolerance)
        expect(Math.abs(identity.d)).toBeLessThanOrEqual(linearTolerance)
        expect(Math.abs(identity.e - 1)).toBeLessThanOrEqual(linearTolerance)
        expect(Math.abs(identity.c)).toBeLessThanOrEqual(translationTolerance)
        expect(Math.abs(identity.f)).toBeLessThanOrEqual(translationTolerance)
      }),
    )
  })

  it('applies a composition as inner first, then outer', () => {
    fc.assert(
      fc.property(affineArb, affineArb, pointArb, (outer, inner, { x, y }) => {
        const viaInner = applyAffine(inner, x, y)
        const stepwise = applyAffine(outer, viaInner.x, viaInner.y)
        const composed = applyAffine(composeAffine(outer, inner), x, y)
        const tolerance =
          RELATIVE_TOLERANCE *
          Math.max(magnitude(inner, x, y), magnitude(outer, viaInner.x, viaInner.y)) *
          (1 + Math.hypot(outer.a, outer.b, outer.d, outer.e))

        expectNear(composed, stepwise, tolerance, 'compose(outer, inner)(p)')
      }),
    )
  })

  it('inverts a composition as the composition of the inverses, reversed', () => {
    fc.assert(
      fc.property(affineArb, affineArb, pointArb, (outer, inner, { x, y }) => {
        const composed = composeAffine(outer, inner)
        const viaInverse = applyAffine(invertAffine(composed), x, y)
        const viaSteps = applyAffine(
          composeAffine(invertAffine(inner), invertAffine(outer)),
          x,
          y,
        )
        // The translations can cancel, so scale by the largest value any
        // step handles, not by the result.
        const scale = Math.max(
          ...[outer, inner, invertAffine(outer), invertAffine(inner)].map((affine) =>
            magnitude(affine, x, y),
          ),
        )
        const tolerance =
          RELATIVE_TOLERANCE * conditionNumber(outer) * conditionNumber(inner) * scale

        expectNear(viaInverse, viaSteps, tolerance, '(outer ∘ inner)⁻¹(p)')
      }),
    )
  })

  it('leaves points and affines unchanged under the identity', () => {
    fc.assert(
      fc.property(affineArb, pointArb, (affine, { x, y }) => {
        const point = applyAffine(IDENTITY_AFFINE, x, y)

        // === rather than toEqual, which tells 0 from -0.
        expect(point.x === x && point.y === y).toBe(true)
        expect(sameAffine(composeAffine(IDENTITY_AFFINE, affine), affine)).toBe(true)
        expect(sameAffine(composeAffine(affine, IDENTITY_AFFINE), affine)).toBe(true)
      }),
    )
  })

  it('refuses to invert a singular or non-finite affine', () => {
    expect(() => invertAffine({ a: 1, b: 2, c: 5, d: 2, e: 4, f: 7 })).toThrow(
      'not invertible',
    )
    expect(() => invertAffine({ a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 })).toThrow(
      'not invertible',
    )
    expect(() => invertAffine({ ...IDENTITY_AFFINE, a: Number.NaN })).toThrow(
      'not invertible',
    )
  })
})

function xy(point: { readonly x: number; readonly y: number }): [number, number] {
  return [point.x, point.y]
}

function sameAffine(left: Affine2D, right: Affine2D): boolean {
  return (['a', 'b', 'c', 'd', 'e', 'f'] as const).every(
    (key) => left[key] === right[key],
  )
}
