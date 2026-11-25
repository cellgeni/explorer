import { Fragment } from 'react'

// The 3D views' hint, bottom right: how the pointer moves the camera, and
// while the canvas has focus, how the keys do (EXP-319). The keys' line is
// the canvas's description, so it stays in the accessibility tree.
const POINTER_HINTS = ['Drag to rotate', 'Shift-drag to pan', 'Scroll to zoom']
const KEY_HINTS = [
  'Shift+arrows rotate',
  'Arrows pan',
  '+ and − zoom',
  'X, Y, Z look along an axis',
  'Home resets',
]

export function VolumeViewerHint({ keysId }: { readonly keysId: string }) {
  return (
    <p className="volume-viewer-hint">
      <span className="volume-viewer-hint-pointer">{phrases(POINTER_HINTS)}</span>
      <span id={keysId} className="volume-viewer-hint-keys">
        {phrases(KEY_HINTS)}
      </span>
    </p>
  )
}

// A line that wraps only after a phrase's dot.
function phrases(hints: readonly string[]) {
  return hints.map((hint, index) =>
    index === hints.length - 1 ? (
      <span key={hint} className="volume-viewer-hint-phrase">
        {hint}
      </span>
    ) : (
      <Fragment key={hint}>
        <span className="volume-viewer-hint-phrase">{`${hint} ·`}</span>{' '}
      </Fragment>
    ),
  )
}
