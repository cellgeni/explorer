// SpatialData stores NGFF-style coordinate transformations per element. The
// viewer only needs the planar x/y part, so every supported transformation is
// reduced to a 2D affine that maps element-intrinsic coordinates into a named
// coordinate system.

export interface Affine2D {
  // x' = a * x + b * y + c
  // y' = d * x + e * y + f
  readonly a: number
  readonly b: number
  readonly c: number
  readonly d: number
  readonly e: number
  readonly f: number
}

export interface SpatialDataCoordinateTransform {
  readonly coordinateSystem: string
  readonly affine: Affine2D
}

export const IDENTITY_AFFINE: Affine2D = { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 }

export class SpatialDataTransformUnsupportedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SpatialDataTransformUnsupportedError'
  }
}

export function applyAffine(
  affine: Affine2D,
  x: number,
  y: number,
): { readonly x: number; readonly y: number } {
  return {
    x: affine.a * x + affine.b * y + affine.c,
    y: affine.d * x + affine.e * y + affine.f,
  }
}

// Returns `outer ∘ inner`: apply `inner` first, then `outer`.
export function composeAffine(outer: Affine2D, inner: Affine2D): Affine2D {
  return {
    a: outer.a * inner.a + outer.b * inner.d,
    b: outer.a * inner.b + outer.b * inner.e,
    c: outer.a * inner.c + outer.b * inner.f + outer.c,
    d: outer.d * inner.a + outer.e * inner.d,
    e: outer.d * inner.b + outer.e * inner.e,
    f: outer.d * inner.c + outer.e * inner.f + outer.f,
  }
}

export function isAxisAlignedAffine(affine: Affine2D): boolean {
  return affine.b === 0 && affine.d === 0 && affine.a > 0 && affine.e > 0
}

// Uniform scale factor of an affine, used to scale circle radii.
export function affineScale(affine: Affine2D): number {
  return Math.sqrt(Math.abs(affine.a * affine.e - affine.b * affine.d))
}

export function readElementCoordinateTransforms(
  attrs: Readonly<Record<string, unknown>>,
): readonly SpatialDataCoordinateTransform[] {
  const metadataRoot = recordOrNull(attrs.ome) ?? attrs
  const multiscales = metadataRoot.multiscales
  const multiscale = Array.isArray(multiscales) ? recordOrNull(multiscales[0]) : null
  const transformations = Array.isArray(multiscale?.coordinateTransformations)
    ? multiscale.coordinateTransformations
    : Array.isArray(attrs.coordinateTransformations)
      ? attrs.coordinateTransformations
      : []
  const transforms: SpatialDataCoordinateTransform[] = []

  for (const transformation of transformations) {
    const record = recordOrNull(transformation)
    const coordinateSystem = transformationSystemName(record?.output)

    if (record === null || coordinateSystem === undefined) {
      continue
    }

    try {
      transforms.push({
        coordinateSystem,
        affine: transformationToAffine(record, transformationAxes(record.input) ?? []),
      })
    } catch (error) {
      // An element stays usable in its other coordinate systems when one of
      // its transformations cannot be represented as a planar affine.
      if (!(error instanceof SpatialDataTransformUnsupportedError)) {
        throw error
      }
    }
  }

  return transforms
}

export function transformationToAffine(
  transformation: unknown,
  inheritedInputAxes: readonly string[],
): Affine2D {
  const record = recordOrNull(transformation)

  if (record === null) {
    throw new SpatialDataTransformUnsupportedError(
      'SpatialData coordinate transformation is not an object.',
    )
  }

  const inputAxes = transformationAxes(record.input) ?? inheritedInputAxes
  const type = record.type

  if (type === 'identity') {
    return IDENTITY_AFFINE
  }

  if (type === 'scale') {
    const values = numberArray(record.scale, 'scale')
    return {
      ...IDENTITY_AFFINE,
      a: axisValue(values, inputAxes, 'x', 1),
      e: axisValue(values, inputAxes, 'y', 1),
    }
  }

  if (type === 'translation') {
    const values = numberArray(record.translation, 'translation')
    return {
      ...IDENTITY_AFFINE,
      c: axisValue(values, inputAxes, 'x', 0),
      f: axisValue(values, inputAxes, 'y', 0),
    }
  }

  if (type === 'affine') {
    return affineMatrixToAffine(
      record.affine,
      inputAxes,
      transformationAxes(record.output) ?? inputAxes,
    )
  }

  if (type === 'mapAxis') {
    return mapAxisToAffine(record.mapAxis, inputAxes)
  }

  if (type === 'sequence') {
    if (!Array.isArray(record.transformations)) {
      throw new SpatialDataTransformUnsupportedError(
        'SpatialData sequence transformation is missing its transformations.',
      )
    }

    let affine = IDENTITY_AFFINE
    let axes = inputAxes

    for (const step of record.transformations) {
      affine = composeAffine(transformationToAffine(step, axes), affine)
      axes = transformationAxes(recordOrNull(step)?.output) ?? axes
    }

    return affine
  }

  throw new SpatialDataTransformUnsupportedError(
    `SpatialData coordinate transformation type ${String(type)} is not supported.`,
  )
}

function affineMatrixToAffine(
  value: unknown,
  inputAxes: readonly string[],
  outputAxes: readonly string[],
): Affine2D {
  if (!Array.isArray(value)) {
    throw new SpatialDataTransformUnsupportedError(
      'SpatialData affine transformation is missing its matrix.',
    )
  }

  const rows = value.map((row) => numberArray(row, 'affine row'))
  const inputX = inputAxes.indexOf('x')
  const inputY = inputAxes.indexOf('y')
  const outputX = outputAxes.indexOf('x')
  const outputY = outputAxes.indexOf('y')
  const rowX = rows[outputX]
  const rowY = rows[outputY]

  if (inputX < 0 || inputY < 0 || rowX === undefined || rowY === undefined) {
    throw new SpatialDataTransformUnsupportedError(
      'SpatialData affine transformation does not map x and y axes.',
    )
  }

  const translationColumn = inputAxes.length

  return {
    a: rowX[inputX] ?? 0,
    b: rowX[inputY] ?? 0,
    c: rowX[translationColumn] ?? 0,
    d: rowY[inputX] ?? 0,
    e: rowY[inputY] ?? 0,
    f: rowY[translationColumn] ?? 0,
  }
}

function mapAxisToAffine(value: unknown, inputAxes: readonly string[]): Affine2D {
  const mapping = recordOrNull(value)

  if (mapping === null) {
    throw new SpatialDataTransformUnsupportedError(
      'SpatialData mapAxis transformation is missing its axis mapping.',
    )
  }

  const sourceForX = typeof mapping.x === 'string' ? mapping.x : 'x'
  const sourceForY = typeof mapping.y === 'string' ? mapping.y : 'y'

  if (
    !['x', 'y'].includes(sourceForX) ||
    !['x', 'y'].includes(sourceForY) ||
    (inputAxes.length > 0 &&
      (!inputAxes.includes(sourceForX) || !inputAxes.includes(sourceForY)))
  ) {
    throw new SpatialDataTransformUnsupportedError(
      'SpatialData mapAxis transformation must map between x and y axes.',
    )
  }

  return {
    a: sourceForX === 'x' ? 1 : 0,
    b: sourceForX === 'y' ? 1 : 0,
    c: 0,
    d: sourceForY === 'x' ? 1 : 0,
    e: sourceForY === 'y' ? 1 : 0,
    f: 0,
  }
}

function axisValue(
  values: readonly number[],
  axes: readonly string[],
  axis: 'x' | 'y',
  fallback: number,
): number {
  const index = axes.indexOf(axis)

  if (index >= 0) {
    return values[index] ?? fallback
  }

  // Without declared axes, assume the trailing values are (..., y, x) for
  // images and (x, y) for two-value vectors such as shapes.
  if (values.length === 2) {
    return values[axis === 'x' ? 0 : 1] ?? fallback
  }

  return values[values.length - (axis === 'x' ? 1 : 2)] ?? fallback
}

function transformationSystemName(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value
  }

  const name = recordOrNull(value)?.name
  return typeof name === 'string' && name.length > 0 ? name : undefined
}

function transformationAxes(value: unknown): readonly string[] | undefined {
  const axes = recordOrNull(value)?.axes

  if (!Array.isArray(axes)) {
    return undefined
  }

  return axes.map((axis) =>
    typeof axis === 'string' ? axis : String(recordOrNull(axis)?.name ?? ''),
  )
}

function numberArray(value: unknown, label: string): readonly number[] {
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === 'number' && Number.isFinite(item))
  ) {
    throw new SpatialDataTransformUnsupportedError(
      `SpatialData ${label} must be an array of finite numbers.`,
    )
  }

  return value
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}
