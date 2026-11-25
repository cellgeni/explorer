import type { OrbitViewState } from '@deck.gl/core'

// Where the data's x, y and z point on screen in the 3D views, for their axes
// indicator (OrbitAxes.tsx), and turning the camera to look along one. Both
// views draw the data at (x, -y, z), so image y runs down the screen as in
// 2D, and orbit about world y (orbitAxis 'Y').

export type OrbitAxisName = 'x' | 'y' | 'z'

export interface OrbitAxisDirection {
  readonly name: OrbitAxisName
  // On screen, right and down: unit length when the axis lies flat in the
  // screen, 0 when it points at the viewer or away.
  readonly dx: number
  readonly dy: number
  // Towards the viewer, from -1 to 1.
  readonly depth: number
}

const DEGREES_TO_RADIANS = Math.PI / 180
// Each data axis in world space.
const DATA_AXES: readonly (readonly [OrbitAxisName, number, number, number])[] = [
  ['x', 1, 0, 0],
  ['y', 0, -1, 0],
  ['z', 0, 0, 1],
]

// The axes, farthest first, so that drawing them in order puts the nearest
// on top. deck.gl's OrbitView turns the world by rotationOrbit about y, then
// by rotationX about x, into camera space (x right, y up, z towards the
// viewer).
export function orbitAxisDirections(
  rotationX: number,
  rotationOrbit: number,
): readonly OrbitAxisDirection[] {
  const cosX = Math.cos(rotationX * DEGREES_TO_RADIANS)
  const sinX = Math.sin(rotationX * DEGREES_TO_RADIANS)
  const cosOrbit = Math.cos(rotationOrbit * DEGREES_TO_RADIANS)
  const sinOrbit = Math.sin(rotationOrbit * DEGREES_TO_RADIANS)

  return DATA_AXES.map(([name, x, y, z]) => {
    const orbitX = cosOrbit * x + sinOrbit * z
    const orbitZ = cosOrbit * z - sinOrbit * x
    const up = cosX * y - sinX * orbitZ

    return { name, dx: orbitX, dy: -up, depth: sinX * y + cosX * orbitZ }
  }).sort((a, b) => a.depth - b.depth)
}

export interface OrbitRotation {
  readonly rotationX: number
  readonly rotationOrbit: number
}

// The camera angles that look along each axis: with it pointing at the
// viewer, then away. Orbiting about y keeps y up and down the screen, except
// when looking along y itself.
const AXIS_VIEWS: Readonly<
  Record<OrbitAxisName, readonly [OrbitRotation, OrbitRotation]>
> = {
  // y down, z to the left; from behind, z to the right.
  x: [
    { rotationX: 0, rotationOrbit: -90 },
    { rotationX: 0, rotationOrbit: 90 },
  ],
  // x right and z up, the stack seen side on; from the other side, z down.
  y: [
    { rotationX: -90, rotationOrbit: 0 },
    { rotationX: 90, rotationOrbit: 0 },
  ],
  // x right and y down, as in 2D; from below, x to the left.
  z: [
    { rotationX: 0, rotationOrbit: 0 },
    { rotationX: 0, rotationOrbit: 180 },
  ],
}
// An axis that points at the viewer this closely is already looked along.
const ALIGNED_DEPTH = 0.999

export function looksAlong(direction: OrbitAxisDirection): boolean {
  return direction.depth > ALIGNED_DEPTH
}

// Where clicking an axis turns the camera: to look along the axis, pointing
// at the viewer, or, when it already does, from the other side.
export function lookAlongAxis(direction: OrbitAxisDirection): OrbitRotation {
  const [towards, away] = AXIS_VIEWS[direction.name]

  return looksAlong(direction) ? away : towards
}

const TURN_DURATION_MS = 500

// The view turned to look along an axis (lookAlongAxis), keeping its centre
// and zoom. deck.gl glides there, unless the system asks for reduced motion.
export function viewAlongAxis(
  viewState: OrbitViewState,
  name: OrbitAxisName,
): OrbitViewState {
  const direction = orbitAxisDirections(
    viewState.rotationX ?? 0,
    viewState.rotationOrbit ?? 0,
  ).find((axis) => axis.name === name)
  if (direction === undefined) return viewState

  return {
    ...viewState,
    ...lookAlongAxis(direction),
    transitionDuration: prefersReducedMotion() ? 0 : TURN_DURATION_MS,
    transitionEasing: easeInOutCubic,
  }
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2
}
