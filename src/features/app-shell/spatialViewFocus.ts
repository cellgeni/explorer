// "Skip To Spatial View" moves focus itself rather than follow its
// #viewer-heading: a new hash would read as a link pasted into the address
// bar. The main view's frame takes focus, so the keys pan it at once, unless
// the start screen or a 3D view covers it; then the region's heading does,
// and the next Tab enters what covers it.
export function focusSpatialView(root: ParentNode): void {
  const region = root.querySelector('.viewer-region')
  if (region === null) return

  const covered = region.querySelector('.start-screen, .volume-viewer') !== null
  const frame = covered
    ? null
    : region.querySelector<HTMLElement>('.viewer-main-tile .viewport-frame')

  ;(frame ?? region.querySelector<HTMLElement>('#viewer-heading'))?.focus()
}
