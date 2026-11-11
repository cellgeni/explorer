import { Button, CloseIcon, IconButton } from '../../components/ui'
import type { UndoToastStore } from './useUndoToast'

// "Removed graphclust: Cluster 3. Undo" for 8 s after a removal
// (UNIFIED_PLAN.md, 15.3-C). Hovering or focusing it keeps it.
export function UndoToast({ store }: { readonly store: UndoToastStore }) {
  const { offer } = store
  if (offer === null) return null

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
      <p>{offer.message}</p>
      <Button title={`Undo: ${offer.message} (Ctrl+Z)`} onClick={store.undo}>
        Undo
      </Button>
      <IconButton title="Dismiss" icon={<CloseIcon />} onClick={store.dismiss} />
    </div>
  )
}
