import { Button, CloseIcon, IconButton, Kbd } from '../../components/ui'
import type { UndoToastStore } from './useUndoToast'

// "Removed graphclust: Cluster 3. Undo Ctrl+Z" for 8 s after a removal
// (plan 15.3-C). Hovering or focusing it keeps it. The shortcut works from
// anywhere, and the status names it, as the toast is far from the removed
// row in the Tab order (EXP-318).
export function UndoToast({ store }: { readonly store: UndoToastStore }) {
  const { notice, offer } = store
  if (offer === null && notice === null) return null
  const shortcut = undoShortcut()

  return (
    <div
      className="undo-toast"
      role="status"
      onPointerEnter={() => {
        store.hold(true)
      }}
      onPointerLeave={() => {
        store.hold(false)
      }}
      onFocus={() => {
        store.hold(true)
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) store.hold(false)
      }}
    >
      {offer === null ? (
        <p>{notice}</p>
      ) : (
        <>
          <p>{offer.message}</p>
          <Button
            title={`Undo: ${offer.message} (${shortcut})`}
            aria-keyshortcuts="Control+Z Meta+Z"
            onClick={store.undo}
          >
            Undo
          </Button>
          <Kbd title={`Undo: ${offer.message}`}>{shortcut}</Kbd>
        </>
      )}
      <IconButton title="Dismiss" icon={<CloseIcon />} onClick={store.dismiss} />
    </div>
  )
}

// Ctrl+Z, or Cmd+Z on Apple devices; either works (useUndoToast).
function undoShortcut(): string {
  return /Mac|iPhone|iPad|iPod/.test(navigator.userAgent) ? 'Cmd+Z' : 'Ctrl+Z'
}
