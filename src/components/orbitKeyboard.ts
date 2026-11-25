import type { KeyboardEvent } from 'react'
import { shortcutLetter } from '../features/shell/shortcuts'
import type { OrbitAxisName } from './orbitAxesModel'

// The 3D views move from the keyboard (EXP-319). Their canvas host is the Tab
// stop, named as the view as the 2D view's frame is; deck.gl's own event root
// stays out of the Tab order (removeDeckFromTabOrder) and takes the keys the
// host hands it: arrow keys pan, Shift with an arrow rotates, + and - zoom.
// Home, which deck.gl leaves alone, resets the camera, and X, Y and Z look
// along an axis, as clicking it in the axes indicator does (OrbitAxes.tsx).

export const ORBIT_KEY_SHORTCUTS =
  'ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown + - X Y Z Home'

const AXIS_KEYS: Readonly<Record<string, OrbitAxisName>> = { X: 'x', Y: 'y', Z: 'z' }

// The codes deck.gl's controller reads (`event.code`).
const ORBIT_KEY_CODES = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Minus',
  'Equal',
  'NumpadSubtract',
  'NumpadAdd',
])

export function handleOrbitKey(
  event: KeyboardEvent<HTMLElement>,
  onReset: () => void,
  onLookAlong: (name: OrbitAxisName) => void,
): void {
  if (event.target !== event.currentTarget) return

  if (event.key === 'Home') {
    event.preventDefault()
    onReset()
    return
  }

  const axis = AXIS_KEYS[shortcutLetter(event) ?? '']
  if (
    axis !== undefined &&
    !event.shiftKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey
  ) {
    event.preventDefault()
    onLookAlong(axis)
    return
  }
  if (!ORBIT_KEY_CODES.has(event.code)) return

  const root = event.currentTarget.querySelector('.deck-events-root')
  if (root === null) return
  // Arrow keys would scroll the page too.
  event.preventDefault()
  root.dispatchEvent(
    new globalThis.KeyboardEvent('keydown', {
      key: event.key,
      code:
        event.code === 'NumpadAdd'
          ? 'Equal'
          : event.code === 'NumpadSubtract'
            ? 'Minus'
            : event.code,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
    }),
  )
}

// The canvas host's attributes: a named, described Tab stop.
export function orbitCanvasProps(label: string, keysId: string) {
  return {
    role: 'img',
    tabIndex: 0,
    'aria-label': label,
    'aria-describedby': keysId,
    'aria-keyshortcuts': ORBIT_KEY_SHORTCUTS,
  } as const
}
