import { useCallback, useEffect, useRef, useState } from 'react'
import {
  readZarrStructure,
  type ReadZarrStructureOptions,
  type ZarrStructure,
} from '../../zarr/zarrStructure'
import {
  createStructuredLoadError,
  type StructuredLoadError,
} from '../errors/loadErrorModel'

export type StoreStructureState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly url: string; readonly nodesRead: number }
  | { readonly status: 'ready'; readonly url: string; readonly structure: ZarrStructure }
  | {
      readonly status: 'error'
      readonly url: string
      readonly error: StructuredLoadError
    }

// The Store structure drawer: Browse Store opens it on an address, and it
// keeps what it read while closed, so reopening it on the same address shows
// the same tree.
export interface StoreStructureStore {
  readonly state: StoreStructureState
  readonly open: boolean
  // Opens the drawer and reads the store, unless it holds this address
  // already.
  readonly browse: (url: string) => void
  // Closes the drawer; a read under way stops.
  readonly close: () => void
  readonly retry: () => void
}

interface UseStoreStructureOptions {
  readonly read?: (
    url: string,
    options: ReadZarrStructureOptions,
  ) => Promise<ZarrStructure>
  readonly fetcher?: typeof fetch
}

// Progress is shown at most this often, so a walk of thousands of nodes does
// not re-render for each.
const PROGRESS_INTERVAL_MS = 100

export function useStoreStructure({
  read = readZarrStructure,
  fetcher,
}: UseStoreStructureOptions = {}): StoreStructureStore {
  const [state, setState] = useState<StoreStructureState>({ status: 'idle' })
  const [open, setOpen] = useState(false)
  const stateRef = useRef(state)
  const controllerRef = useRef<AbortController | null>(null)

  const update = useCallback((next: StoreStructureState) => {
    stateRef.current = next
    setState(next)
  }, [])

  useEffect(() => {
    return () => {
      controllerRef.current?.abort()
    }
  }, [])

  const start = useCallback(
    (url: string) => {
      controllerRef.current?.abort()
      const controller = new AbortController()
      controllerRef.current = controller
      update({ status: 'loading', url, nodesRead: 0 })
      let shownAt = 0

      read(url, {
        signal: controller.signal,
        ...(fetcher === undefined ? {} : { fetcher }),
        onProgress: (nodesRead) => {
          const now = performance.now()
          if (controller.signal.aborted || now - shownAt < PROGRESS_INTERVAL_MS) return
          shownAt = now
          update({ status: 'loading', url, nodesRead })
        },
      }).then(
        (structure) => {
          if (controller.signal.aborted) return
          update({ status: 'ready', url, structure })
        },
        (error: unknown) => {
          if (controller.signal.aborted) return
          update({
            status: 'error',
            url,
            error: createStructuredLoadError('Store structure', error),
          })
        },
      )
    },
    [fetcher, read, update],
  )

  const browse = useCallback(
    (url: string) => {
      setOpen(true)
      const current = stateRef.current
      const held =
        current.status !== 'idle' && current.status !== 'error' && current.url === url
      if (!held) start(url)
    },
    [start],
  )

  const close = useCallback(() => {
    setOpen(false)

    if (stateRef.current.status === 'loading') {
      controllerRef.current?.abort()
      update({ status: 'idle' })
    }
  }, [update])

  const retry = useCallback(() => {
    const current = stateRef.current
    if (current.status !== 'idle') start(current.url)
  }, [start])

  return { state, open, browse, close, retry }
}
