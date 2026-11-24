// The 3D views' hint, bottom right: how the pointer moves the camera, and
// while the canvas has focus, how the keys do (EXP-319). The keys' line is
// the canvas's description, so it stays in the accessibility tree.
export function VolumeViewerHint({ keysId }: { readonly keysId: string }) {
  return (
    <p className="volume-viewer-hint">
      <span className="volume-viewer-hint-pointer">
        Drag to rotate · Shift-drag to pan · Scroll to zoom
      </span>
      <span id={keysId} className="volume-viewer-hint-keys">
        Shift+arrows rotate · Arrows pan · + and − zoom · Home resets
      </span>
    </p>
  )
}
