import type { PythonSession } from './pythonSession'

// The Python console window's model (plan 29-D11).

export interface PythonPickedPoint {
  // Changes with every pick, so the same point picked twice is written twice.
  readonly id: number
  // µm, y down.
  readonly x: number
  readonly y: number
}

export interface PythonConsoleModel {
  readonly session: PythonSession
  // A click on the canvas is armed to give a point.
  readonly picking: boolean
  readonly onPickingChange: (picking: boolean) => void
  readonly pickedPoint: PythonPickedPoint | null
}

// "(5210.4, 3180.9)", to one decimal of a micrometre.
export function formatPickedPoint(point: {
  readonly x: number
  readonly y: number
}): string {
  return `(${point.x.toFixed(1)}, ${point.y.toFixed(1)})`
}
