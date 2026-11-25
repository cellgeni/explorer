import { memo } from 'react'
import { looksAlong, orbitAxisDirections, type OrbitAxisName } from './orbitAxesModel'

// The 3D views' axes indicator, top right: the data's x, y and z as they
// point at the camera's angles, so that a drag shows which way it turns or
// moves the data. Axes pointing away from the viewer fade and are drawn
// behind. Clicking an axis turns the camera to look along it, and again to
// look from the other side. Like dragging, that is part of the canvas: the
// canvas's X, Y and Z keys do the same (orbitKeyboard.ts), as the axes move
// over each other and so cannot each be a Tab stop with room around it.

// In the SVG's units, about its centre.
const AXIS_LENGTH = 30
const LABEL_RADIUS = 9
// A 24 px target around each label (EXP-321).
const TARGET_RADIUS = 12
// The faintest an axis gets, pointing straight away.
const AWAY_OPACITY = 0.55

export const OrbitAxes = memo(function OrbitAxes({
  rotationX,
  rotationOrbit,
  onLookAlong,
}: {
  readonly rotationX: number
  readonly rotationOrbit: number
  readonly onLookAlong: (name: OrbitAxisName) => void
}) {
  return (
    <svg className="orbit-axes" viewBox="-44 -44 88 88" aria-hidden="true">
      {orbitAxisDirections(rotationX, rotationOrbit).map((direction) => {
        const { name, depth } = direction
        const x = direction.dx * AXIS_LENGTH
        const y = direction.dy * AXIS_LENGTH

        return (
          <g
            key={name}
            className={`orbit-axis orbit-axis-${name}`}
            opacity={depth < 0 ? 1 + (1 - AWAY_OPACITY) * depth : 1}
            onClick={() => {
              onLookAlong(name)
            }}
          >
            <title>
              {`Turn the view so that ${name} points ${looksAlong(direction) ? 'away from you' : 'at you'} (${name.toUpperCase()})`}
            </title>
            <line x1={0} y1={0} x2={x} y2={y} />
            <circle className="orbit-axis-target" cx={x} cy={y} r={TARGET_RADIUS} />
            <circle className="orbit-axis-label" cx={x} cy={y} r={LABEL_RADIUS} />
            <text x={x} y={y} dy="0.35em">
              {name}
            </text>
          </g>
        )
      })}
    </svg>
  )
})
