import { useSyncExternalStore } from 'react'

// Under 860 px the new shell folds the tools into a menu, turns the layer
// panel into a bottom sheet and docks the cards at the bottom
// (UNIFIED_PLAN.md, 15.2-I).
export const NARROW_SCREEN_QUERY = '(max-width: 859.98px)'

function narrowQuery(): MediaQueryList | null {
  return typeof window === 'undefined' || typeof window.matchMedia !== 'function'
    ? null
    : window.matchMedia(NARROW_SCREEN_QUERY)
}

function subscribe(onChange: () => void): () => void {
  const query = narrowQuery()
  query?.addEventListener('change', onChange)
  return () => {
    query?.removeEventListener('change', onChange)
  }
}

function isNarrow(): boolean {
  return narrowQuery()?.matches ?? false
}

export function useNarrowScreen(): boolean {
  return useSyncExternalStore(subscribe, isNarrow, () => false)
}
