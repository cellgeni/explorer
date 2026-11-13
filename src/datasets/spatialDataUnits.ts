// SpatialData coordinate systems often use unit-less axes ("unit"): for
// example spatialdata-io Xenium and Visium stores place everything in image
// pixels. The viewer works in micrometers, so each coordinate system needs a
// micrometers-per-unit factor. It comes from, in order: a user override, the
// axis units declared on the coordinate system, an estimate from the data, or
// stays unknown (1 unit shown as 1 µm, labelled as units).

export type SpatialDataUnitsSource = 'override' | 'declared' | 'estimated' | 'unknown'

export interface SpatialDataUnits {
  readonly micrometersPerUnit: number
  readonly source: SpatialDataUnitsSource
  readonly detail: string
}

export const UNKNOWN_SPATIALDATA_UNITS: SpatialDataUnits = {
  micrometersPerUnit: 1,
  source: 'unknown',
  detail: 'coordinate system axes have no physical unit',
}

// Visium spots sit on a hexagonal lattice with 100 µm between neighbours.
const VISIUM_SPOT_PITCH_MICROMETERS = 100
const MIN_ESTIMATE_SAMPLES = 20
const MAX_PITCH_SAMPLES = 2_000

const MICROMETERS_PER_UNIT: Readonly<Record<string, number>> = {
  angstrom: 1e-4,
  nanometer: 1e-3,
  nm: 1e-3,
  micrometer: 1,
  micron: 1,
  um: 1,
  µm: 1,
  μm: 1,
  millimeter: 1e3,
  mm: 1e3,
  centimeter: 1e4,
  cm: 1e4,
  meter: 1e6,
  m: 1e6,
}

export function overrideSpatialDataUnits(
  micrometersPerUnit: number,
): SpatialDataUnits | null {
  return Number.isFinite(micrometersPerUnit) && micrometersPerUnit > 0
    ? {
        micrometersPerUnit,
        source: 'override',
        detail: 'set in the viewer',
      }
    : null
}

// Reads the physical unit of the x/y axes that elements declare for the
// coordinate system, from the `output` side of their transformations.
export function declaredSpatialDataUnits(
  elementAttrs: readonly Readonly<Record<string, unknown>>[],
  coordinateSystem: string,
): SpatialDataUnits | null {
  for (const attrs of elementAttrs) {
    for (const transformation of elementTransformations(attrs)) {
      const output = recordOrNull(recordOrNull(transformation)?.output)

      if (output?.name !== coordinateSystem || !Array.isArray(output.axes)) {
        continue
      }

      const units = output.axes
        .map((axis) => recordOrNull(axis))
        .filter((axis) => axis?.name === 'x' || axis?.name === 'y')
        .map((axis) => (typeof axis?.unit === 'string' ? axis.unit.trim() : ''))
      const factor = units.length > 0 ? MICROMETERS_PER_UNIT[units[0] ?? ''] : undefined

      if (factor !== undefined && units.every((unit) => unit === units[0])) {
        return {
          micrometersPerUnit: factor,
          source: 'declared',
          detail: `axis unit ${units[0] ?? ''}`,
        }
      }
    }
  }

  return null
}

// Cell areas in µm² (Xenium `cell_area`, `area`) against the same cells'
// geometric areas in coordinate-system units².
export function estimateUnitsFromAreas(
  pairs: readonly {
    readonly micrometersSquared: number
    readonly unitsSquared: number
  }[],
  detail: string,
): SpatialDataUnits | null {
  const ratios = pairs
    .filter(
      (pair) =>
        Number.isFinite(pair.micrometersSquared) &&
        pair.micrometersSquared > 0 &&
        Number.isFinite(pair.unitsSquared) &&
        pair.unitsSquared > 0,
    )
    .map((pair) => pair.micrometersSquared / pair.unitsSquared)

  if (ratios.length < MIN_ESTIMATE_SAMPLES) {
    return null
  }

  return positiveEstimate(Math.sqrt(median(ratios)), detail)
}

// Visium spot centres in coordinate-system units: the median nearest-neighbour
// distance is the 100 µm lattice pitch.
export function estimateUnitsFromVisiumSpots(
  centers: readonly { readonly x: number; readonly y: number }[],
): SpatialDataUnits | null {
  if (centers.length < MIN_ESTIMATE_SAMPLES) {
    return null
  }

  const pitch = medianNearestNeighbourDistance(centers)

  return pitch === null
    ? null
    : positiveEstimate(
        VISIUM_SPOT_PITCH_MICROMETERS / pitch,
        `Visium spot pitch (${VISIUM_SPOT_PITCH_MICROMETERS} µm)`,
      )
}

// Visium HD bins named like `square_008um` have a known side length.
export function estimateUnitsFromVisiumHdBins(
  elementName: string,
  binAreasInUnits: readonly number[],
): SpatialDataUnits | null {
  const match = /square_(\d{3})um/i.exec(elementName)
  const side = match === null ? Number.NaN : Number(match[1])
  const areas = binAreasInUnits.filter((area) => Number.isFinite(area) && area > 0)

  if (!Number.isFinite(side) || side <= 0 || areas.length < MIN_ESTIMATE_SAMPLES) {
    return null
  }

  return positiveEstimate(
    side / Math.sqrt(median(areas)),
    `Visium HD ${side.toString()} µm bins`,
  )
}

export function formatSpatialDataUnits(units: SpatialDataUnits): string {
  if (units.source === 'unknown') {
    return `unknown (${units.detail}; shown as 1 µm per unit)`
  }

  return `${formatFactor(units.micrometersPerUnit)} µm per unit (${units.source}: ${units.detail})`
}

function formatFactor(value: number): string {
  return value.toLocaleString(undefined, { maximumSignificantDigits: 4 })
}

function positiveEstimate(value: number, detail: string): SpatialDataUnits | null {
  return Number.isFinite(value) && value > 0
    ? { micrometersPerUnit: value, source: 'estimated', detail }
    : null
}

function medianNearestNeighbourDistance(
  points: readonly { readonly x: number; readonly y: number }[],
): number | null {
  const sample =
    points.length <= MAX_PITCH_SAMPLES
      ? points
      : Array.from(
          { length: MAX_PITCH_SAMPLES },
          (_value, index) =>
            points[Math.floor((index * points.length) / MAX_PITCH_SAMPLES)] ?? {
              x: 0,
              y: 0,
            },
        )
  const sorted = [...points].sort((left, right) => left.x - right.x)
  const distances: number[] = []

  for (const point of sample) {
    let best = Number.POSITIVE_INFINITY
    const low = lowerBound(sorted, point.x)

    // Walk outwards in x until the x gap alone exceeds the best distance.
    for (let left = low - 1, right = low; left >= 0 || right < sorted.length; ) {
      const leftPoint = left >= 0 ? sorted[left] : undefined
      const rightPoint = right < sorted.length ? sorted[right] : undefined
      const leftGap = leftPoint === undefined ? Infinity : point.x - leftPoint.x
      const rightGap = rightPoint === undefined ? Infinity : rightPoint.x - point.x

      if (Math.min(leftGap, rightGap) > best) {
        break
      }

      const candidate = leftGap <= rightGap ? leftPoint : rightPoint

      if (leftGap <= rightGap) {
        left -= 1
      } else {
        right += 1
      }

      if (candidate === undefined || candidate === point) {
        continue
      }

      const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y)

      if (distance > 0 && distance < best) {
        best = distance
      }
    }

    if (Number.isFinite(best)) {
      distances.push(best)
    }
  }

  return distances.length === 0 ? null : median(distances)
}

function lowerBound(sorted: readonly { readonly x: number }[], value: number): number {
  let low = 0
  let high = sorted.length

  while (low < high) {
    const middle = (low + high) >>> 1

    if ((sorted[middle]?.x ?? Infinity) < value) {
      low = middle + 1
    } else {
      high = middle
    }
  }

  return low
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)

  return sorted.length % 2 === 1
    ? (sorted[middle] ?? Number.NaN)
    : ((sorted[middle - 1] ?? Number.NaN) + (sorted[middle] ?? Number.NaN)) / 2
}

function elementTransformations(
  attrs: Readonly<Record<string, unknown>>,
): readonly unknown[] {
  const metadataRoot = recordOrNull(attrs.ome) ?? attrs
  const multiscales = metadataRoot.multiscales
  const multiscale = Array.isArray(multiscales) ? recordOrNull(multiscales[0]) : null

  if (Array.isArray(multiscale?.coordinateTransformations)) {
    return multiscale.coordinateTransformations
  }

  return Array.isArray(attrs.coordinateTransformations)
    ? attrs.coordinateTransformations
    : []
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}
