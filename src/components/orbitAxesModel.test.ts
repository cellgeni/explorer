import { OrbitViewport } from '@deck.gl/core'
import { describe, expect, it } from 'vitest'
import {
  lookAlongAxis,
  looksAlong,
  orbitAxisDirections,
  type OrbitAxisDirection,
  type OrbitAxisName,
  type OrbitRotation,
} from './orbitAxesModel'

function byName(axes: readonly OrbitAxisDirection[]) {
  return Object.fromEntries(
    axes.map(({ name, dx, dy, depth }) => [name, [dx, dy, depth]] as const),
  )
}

describe('orbitAxisDirections', () => {
  it('shows x right, image y down and z towards the viewer, looking straight down', () => {
    const axes = byName(orbitAxisDirections(0, 0))

    expect(axes).toEqual({
      x: [1, expect.closeTo(0), 0],
      y: [0, 1, 0],
      z: [0, expect.closeTo(0), 1],
    })
  })

  it('lists the axes farthest first', () => {
    // The opening view: tilted 30° and turned -30°.
    expect(orbitAxisDirections(30, -30).map((axis) => axis.name)).toEqual(['y', 'x', 'z'])
    expect(orbitAxisDirections(0, 180).map((axis) => axis.name)).toEqual(['z', 'x', 'y'])
  })

  it("turns as deck.gl's OrbitView turns the world", () => {
    for (const [rotationX, rotationOrbit] of [
      [30, -30],
      [-75, 140],
      [90, 0],
      [12, -200],
    ] as const) {
      const viewport = new OrbitViewport({
        width: 400,
        height: 300,
        orbitAxis: 'Y',
        rotationX,
        rotationOrbit,
        zoom: 0,
      })
      const view = viewport.viewMatrix
      const axes = byName(orbitAxisDirections(rotationX, rotationOrbit))

      for (const [name, world] of [
        ['x', [1, 0, 0]],
        ['y', [0, -1, 0]],
        ['z', [0, 0, 1]],
      ] as const) {
        // The view matrix's rotation, scaled; its camera y is up.
        const camera = [0, 1, 2].map(
          (row) =>
            (view[row] ?? 0) * world[0] +
            (view[row + 4] ?? 0) * world[1] +
            (view[row + 8] ?? 0) * world[2],
        )
        const length = Math.hypot(...camera)
        const [dx, dy, depth] = axes[name] ?? []

        expect(dx).toBeCloseTo((camera[0] ?? 0) / length, 6)
        expect(dy).toBeCloseTo(-(camera[1] ?? 0) / length, 6)
        expect(depth).toBeCloseTo((camera[2] ?? 0) / length, 6)
      }
    }
  })
})

describe('lookAlongAxis', () => {
  function direction(name: OrbitAxisName, { rotationX, rotationOrbit }: OrbitRotation) {
    const found = orbitAxisDirections(rotationX, rotationOrbit).find(
      (axis) => axis.name === name,
    )
    if (found === undefined) throw new Error(`No ${name} axis.`)
    return found
  }

  it('turns each axis to point at the viewer, then away', () => {
    const opening = { rotationX: 30, rotationOrbit: -30 }

    for (const name of ['x', 'y', 'z'] as const) {
      const towards = lookAlongAxis(direction(name, opening))
      expect(direction(name, towards).depth).toBeCloseTo(1, 9)
      expect(looksAlong(direction(name, towards))).toBe(true)

      const away = lookAlongAxis(direction(name, towards))
      expect(direction(name, away).depth).toBeCloseTo(-1, 9)
      // And back.
      expect(lookAlongAxis(direction(name, away))).toEqual(towards)
    }
  })

  it('shows z as the 2D view does, and the stack side on along y', () => {
    const topDown = lookAlongAxis(direction('z', { rotationX: 30, rotationOrbit: -30 }))
    expect(topDown).toEqual({ rotationX: 0, rotationOrbit: 0 })

    const sideOn = byName(orbitAxisDirections(-90, 0))
    expect(lookAlongAxis(direction('y', topDown))).toEqual({
      rotationX: -90,
      rotationOrbit: 0,
    })
    // x right, z up.
    expect(sideOn.x?.[0]).toBeCloseTo(1, 9)
    expect(sideOn.z?.[1]).toBeCloseTo(-1, 9)
  })
})
