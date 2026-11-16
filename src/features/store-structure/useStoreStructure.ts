import { useCallback, useEffect, useRef, useState } from 'react'
import {
  readParquetStructure,
  type ParquetFileRef,
  type ParquetStructure,
  type ReadParquetStructureOptions,
} from '../../data/parquetStructure'
import {
  readZarrStructure,
  type ReadZarrStructureOptions,
  type ZarrStructure,
} from '../../zarr/zarrStructure'
import {
  createStructuredLoadError,
  type StructuredLoadError,
} from '../errors/loadErrorModel'
import { isParquetUrl, sameParquetFile } from './parquetStructureModel'

export type StructureReadState<Target, Value> =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly target: Target; readonly progress: number }
  | { readonly status: 'ready'; readonly target: Target; readonly value: Value }
  | {
      readonly status: 'error'
      readonly target: Target
      readonly error: StructuredLoadError
    }

// A Zarr store by address; progress counts the nodes read.
export type StoreStructureState = StructureReadState<string, ZarrStructure>
export type ParquetFileState = StructureReadState<ParquetFileRef, ParquetStructure>

// The structure drawer: Browse Store or Browse File opens it on an address,
// and Browse File in the store's tree opens a Parquet file the store holds.
// It keeps what it read while closed, so reopening it on the same address
// shows the same tree.
export interface StoreStructureStore {
  readonly store: StoreStructureState
  readonly file: ParquetFileState
  // What the drawer shows.
  readonly view: 'store' | 'file'
  // The file was opened from the store's tree, so Back returns there.
  readonly fileFromStore: boolean
  readonly open: boolean
  // Opens the drawer on a Zarr store or a Parquet file, and reads it unless
  // the drawer holds it already.
  readonly browse: (url: string) => void
  // Opens a Parquet file from the store's tree.
  readonly browseFile: (file: ParquetFileRef) => void
  readonly back: () => void
  // Closes the drawer; a read under way stops.
  readonly close: () => void
  readonly retry: () => void
}

interface UseStoreStructureOptions {
  readonly read?: (
    url: string,
    options: ReadZarrStructureOptions,
  ) => Promise<ZarrStructure>
  readonly readParquet?: (
    file: ParquetFileRef,
    options: ReadParquetStructureOptions,
  ) => Promise<ParquetStructure>
  readonly fetcher?: typeof fetch
}

export function useStoreStructure({
  read = readZarrStructure,
  readParquet = readParquetStructure,
  fetcher,
}: UseStoreStructureOptions = {}): StoreStructureStore {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'store' | 'file'>('store')
  const [fileFromStore, setFileFromStore] = useState(false)
  const readStore = useCallback(
    (url: string, signal: AbortSignal, onProgress: (count: number) => void) =>
      read(url, { signal, onProgress, ...(fetcher === undefined ? {} : { fetcher }) }),
    [fetcher, read],
  )
  const readFile = useCallback(
    (file: ParquetFileRef, signal: AbortSignal) =>
      readParquet(file, { signal, ...(fetcher === undefined ? {} : { fetcher }) }),
    [fetcher, readParquet],
  )
  const store = useStructureRead(readStore, sameStore)
  const file = useStructureRead(readFile, sameParquetFile)
  const { ensure: ensureStore, retry: retryStore, stop: stopStore } = store
  const { ensure: ensureFile, retry: retryFile, stop: stopFile } = file

  const openFile = useCallback(
    (target: ParquetFileRef) => {
      setOpen(true)
      setView('file')
      ensureFile(target)
    },
    [ensureFile],
  )

  const browse = useCallback(
    (url: string) => {
      if (isParquetUrl(url)) {
        setFileFromStore(false)
        openFile({ url })
        return
      }

      setOpen(true)
      setView('store')
      ensureStore(url)
    },
    [ensureStore, openFile],
  )

  const browseFile = useCallback(
    (target: ParquetFileRef) => {
      setFileFromStore(true)
      openFile(target)
    },
    [openFile],
  )

  const back = useCallback(() => {
    setView('store')
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    stopStore()
    stopFile()
  }, [stopFile, stopStore])

  const retry = useCallback(() => {
    if (view === 'file') retryFile()
    else retryStore()
  }, [retryFile, retryStore, view])

  return {
    store: store.state,
    file: file.state,
    view,
    fileFromStore,
    open,
    browse,
    browseFile,
    back,
    close,
    retry,
  }
}

function sameStore(a: string, b: string): boolean {
  return a === b
}

// Progress is shown at most this often, so a walk of thousands of nodes does
// not re-render for each.
const PROGRESS_INTERVAL_MS = 100

interface StructureRead<Target, Value> {
  readonly state: StructureReadState<Target, Value>
  // Reads `target`, stopping any read under way, unless it is being read or
  // has been read already.
  readonly ensure: (target: Target) => void
  // Stops a read under way, forgetting it.
  readonly stop: () => void
  // Reads the last target again.
  readonly retry: () => void
}

function useStructureRead<Target, Value>(
  read: (
    target: Target,
    signal: AbortSignal,
    onProgress: (count: number) => void,
  ) => Promise<Value>,
  same: (a: Target, b: Target) => boolean,
): StructureRead<Target, Value> {
  const [state, setState] = useState<StructureReadState<Target, Value>>({
    status: 'idle',
  })
  const stateRef = useRef(state)
  const controllerRef = useRef<AbortController | null>(null)

  const update = useCallback((next: StructureReadState<Target, Value>) => {
    stateRef.current = next
    setState(next)
  }, [])

  useEffect(() => {
    return () => {
      controllerRef.current?.abort()
    }
  }, [])

  const start = useCallback(
    (target: Target) => {
      controllerRef.current?.abort()
      const controller = new AbortController()
      controllerRef.current = controller
      update({ status: 'loading', target, progress: 0 })
      let shownAt = 0

      read(target, controller.signal, (progress) => {
        const now = performance.now()
        if (controller.signal.aborted || now - shownAt < PROGRESS_INTERVAL_MS) return
        shownAt = now
        update({ status: 'loading', target, progress })
      }).then(
        (value) => {
          if (controller.signal.aborted) return
          update({ status: 'ready', target, value })
        },
        (error: unknown) => {
          if (controller.signal.aborted) return
          update({
            status: 'error',
            target,
            error: createStructuredLoadError('Store structure', error),
          })
        },
      )
    },
    [read, update],
  )

  const ensure = useCallback(
    (target: Target) => {
      const current = stateRef.current
      const held =
        (current.status === 'loading' || current.status === 'ready') &&
        same(current.target, target)
      if (!held) start(target)
    },
    [same, start],
  )

  const stop = useCallback(() => {
    if (stateRef.current.status === 'loading') {
      controllerRef.current?.abort()
      update({ status: 'idle' })
    }
  }, [update])

  const retry = useCallback(() => {
    const current = stateRef.current
    if (current.status !== 'idle') start(current.target)
  }, [start])

  return { state, ensure, stop, retry }
}
