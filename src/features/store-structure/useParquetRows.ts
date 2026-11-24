import { useCallback, useEffect, useRef, useState } from 'react'
import { PARQUET_PREVIEW_COLUMNS, type ParquetRowPreview } from '../../data/parquetRows'
import type { ParquetStructure } from '../../data/parquetStructure'
import {
  createStructuredLoadError,
  type StructuredLoadError,
} from '../errors/loadErrorModel'

export type ParquetRowsState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | {
      readonly status: 'ready'
      readonly preview: ParquetRowPreview
      // The next columns, read on request.
      readonly more: ParquetMoreColumnsState
    }
  | { readonly status: 'error'; readonly error: StructuredLoadError }

export type ParquetMoreColumnsState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: StructuredLoadError }

export type ParquetRowsReader = (
  structure: ParquetStructure,
  signal: AbortSignal,
  // The top-level fields to read; the first page of them when left out.
  columns?: readonly string[],
) => Promise<ParquetRowPreview>

// Rows are read as soon as the Rows view opens when the most they can cost
// is this; past it, on request.
export const AUTO_READ_ROWS_BYTES = 8_000_000

// Why a read stopped when the drawer closed or left the file: the read is
// forgotten, so Read Rows offers it again.
const CLOSED = Symbol('closed')

// The first rows of a file, read on request and kept while the file is open.
// `active` is whether the file is shown: closing the drawer or going back to
// the store stops a read, as the docs say.
export function useParquetRows(
  structure: ParquetStructure,
  readRows: ParquetRowsReader,
  active = true,
) {
  const [state, setState] = useState<ParquetRowsState>({ status: 'idle' })
  const controllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => {
      controllerRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (!active) controllerRef.current?.abort(CLOSED)
  }, [active])

  const run = useCallback(
    (
      columns: readonly string[] | undefined,
      onRead: (preview: ParquetRowPreview) => void,
      onStopped: () => void,
      onError: (error: StructuredLoadError) => void,
    ) => {
      controllerRef.current?.abort()
      const controller = new AbortController()
      controllerRef.current = controller

      readRows(structure, controller.signal, columns).then(
        (preview) => {
          if (!controller.signal.aborted) onRead(preview)
        },
        (error: unknown) => {
          if (controller.signal.aborted) {
            if (controller.signal.reason === CLOSED) onStopped()
            return
          }
          onError(createStructuredLoadError('Store structure', error))
        },
      )
    },
    [readRows, structure],
  )

  const read = useCallback(() => {
    setState({ status: 'loading' })
    run(
      undefined,
      (preview) => {
        setState({ status: 'ready', preview, more: { status: 'idle' } })
      },
      () => {
        setState({ status: 'idle' })
      },
      (error) => {
        setState({ status: 'error', error })
      },
    )
  }, [run])

  // The next PARQUET_PREVIEW_COLUMNS top-level fields, added to the table.
  const readMore = useCallback(() => {
    if (state.status !== 'ready') return
    const { preview } = state
    const columns = structure.root.children
      .slice(preview.columns.length, preview.columns.length + PARQUET_PREVIEW_COLUMNS)
      .map((child) => child.name)
    if (columns.length === 0) return

    const withMore = (more: ParquetMoreColumnsState) =>
      setState((current) =>
        current.status === 'ready' && current.preview === preview
          ? { ...current, more }
          : current,
      )

    withMore({ status: 'loading' })
    run(
      columns,
      (next) => {
        setState((current) =>
          current.status === 'ready' && current.preview === preview
            ? {
                status: 'ready',
                preview: {
                  ...preview,
                  columns: [...preview.columns, ...next.columns],
                  bytesRead: preview.bytesRead + next.bytesRead,
                },
                more: { status: 'idle' },
              }
            : current,
        )
      },
      () => {
        withMore({ status: 'idle' })
      },
      (error) => {
        withMore({ status: 'error', error })
      },
    )
  }, [run, state, structure])

  return { state, read, readMore }
}
