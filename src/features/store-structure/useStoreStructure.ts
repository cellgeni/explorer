import { useCallback, useEffect, useRef, useState } from 'react'
import {
  readH5Structure,
  type H5Structure,
  type ReadH5StructureOptions,
} from '../../data/h5Structure'
import {
  readParquetRows,
  type ParquetRowPreview,
  type ReadParquetRowsOptions,
} from '../../data/parquetRows'
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
import { isH5Url, sameH5File } from './h5StructureModel'
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
// An HDF5 file by address; progress counts the objects read.
export type H5FileState = StructureReadState<string, H5Structure>

export type StructureView = 'store' | 'file' | 'h5'

// The structure drawer: Browse Store or Browse File opens it on an address,
// and Browse File in the store's tree opens a Parquet file the store holds.
// It keeps what it read while closed, so reopening it on the same address
// shows the same tree; an HDF5 file's worker stays open for its values until
// another file replaces it.
export interface StoreStructureStore {
  readonly store: StoreStructureState
  readonly file: ParquetFileState
  readonly h5: H5FileState
  // What the drawer shows.
  readonly view: StructureView
  // The file was opened from the store's tree, so Back returns there.
  readonly fileFromStore: boolean
  readonly open: boolean
  // Opens the drawer on a Zarr store, a Parquet file or an HDF5 file, and
  // reads it unless the drawer holds it already.
  readonly browse: (url: string) => void
  // Opens a Parquet file from the store's tree.
  readonly browseFile: (file: ParquetFileRef) => void
  readonly back: () => void
  // Reads the first rows of a file that has been read.
  readonly readRows: (
    structure: ParquetStructure,
    signal: AbortSignal,
  ) => Promise<ParquetRowPreview>
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
  readonly readParquetRows?: (
    structure: ParquetStructure,
    options: ReadParquetRowsOptions,
  ) => Promise<ParquetRowPreview>
  readonly readH5?: (url: string, options: ReadH5StructureOptions) => Promise<H5Structure>
  readonly fetcher?: typeof fetch
}

export function useStoreStructure({
  read = readZarrStructure,
  readParquet = readParquetStructure,
  readParquetRows: readRowsOf = readParquetRows,
  readH5 = readH5Structure,
  fetcher,
}: UseStoreStructureOptions = {}): StoreStructureStore {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<StructureView>('store')
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
  const readRows = useCallback(
    (structure: ParquetStructure, signal: AbortSignal, columns?: readonly string[]) =>
      readRowsOf(structure, {
        signal,
        ...(columns === undefined ? {} : { columns }),
        ...(fetcher === undefined ? {} : { fetcher }),
      }),
    [fetcher, readRowsOf],
  )
  // The worker reads the file itself, so `fetcher` does not apply.
  const readH5File = useCallback(
    (url: string, signal: AbortSignal, onProgress: (count: number) => void) =>
      readH5(url, { signal, onProgress }),
    [readH5],
  )
  const store = useStructureRead(readStore, sameStore)
  const file = useStructureRead(readFile, sameParquetFile)
  const h5 = useStructureRead(readH5File, sameH5File)
  const { ensure: ensureStore, retry: retryStore, stop: stopStore } = store
  const { ensure: ensureFile, retry: retryFile, stop: stopFile } = file
  const { ensure: ensureH5, retry: retryH5, stop: stopH5 } = h5
  useCloseReplaced(h5.state)

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

      if (isH5Url(url)) {
        setOpen(true)
        setView('h5')
        ensureH5(url)
        return
      }

      setOpen(true)
      setView('store')
      ensureStore(url)
    },
    [ensureH5, ensureStore, openFile],
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
    stopH5()
  }, [stopFile, stopH5, stopStore])

  const retry = useCallback(() => {
    if (view === 'file') retryFile()
    else if (view === 'h5') retryH5()
    else retryStore()
  }, [retryFile, retryH5, retryStore, view])

  return {
    store: store.state,
    file: file.state,
    h5: h5.state,
    view,
    fileFromStore,
    open,
    browse,
    browseFile,
    back,
    readRows,
    close,
    retry,
  }
}

function sameStore(a: string, b: string): boolean {
  return a === b
}

// Closes an HDF5 file's worker once the drawer no longer holds its structure:
// another file or a retry replaced it, or the drawer went away.
function useCloseReplaced(state: H5FileState): void {
  const heldRef = useRef<H5Structure | null>(null)
  const current = state.status === 'ready' ? state.value : null

  useEffect(() => {
    const held = heldRef.current
    if (held !== null && held !== current) held.close()
    heldRef.current = current
  }, [current])

  useEffect(() => {
    return () => {
      heldRef.current?.close()
      heldRef.current = null
    }
  }, [])
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
