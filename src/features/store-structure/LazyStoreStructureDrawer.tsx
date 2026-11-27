import { lazy } from 'react'
import { LazyPanel } from '../../components/LazyPanel'
import { Drawer } from '../../components/ui'
import { useOpenedOnce } from '../../components/useOpenedOnce'
import { STORE_STRUCTURE_DRAWER_TITLES } from './storeStructureModel'
import type { StoreStructureStore } from './useStoreStructure'

// Browse Store and Browse File load the first time the drawer opens, not with
// the app (O21).
const StoreStructureDrawer = lazy(async () => {
  const module = await import('./StoreStructureDrawer')
  return { default: module.StoreStructureDrawer }
})

// The Browse drawer, mounted from its first open on, so it keeps its open
// groups once closed. While it loads, or if it cannot, the drawer shows a
// line saying so.
export function LazyStoreStructureDrawer({
  store,
}: {
  readonly store: StoreStructureStore
}) {
  const opened = useOpenedOnce(store.open)

  if (!opened) {
    return null
  }

  return (
    <LazyPanel
      label="Browse"
      frame={(content) => (
        <Drawer
          title={STORE_STRUCTURE_DRAWER_TITLES[store.view]}
          side="right"
          open={store.open}
          onClose={store.close}
          className="store-structure-drawer"
        >
          {content}
        </Drawer>
      )}
    >
      <StoreStructureDrawer store={store} />
    </LazyPanel>
  )
}
