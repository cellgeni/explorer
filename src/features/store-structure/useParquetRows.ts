import { useCallback, useEffect, useRef, useState } from 'react'
import type { ParquetRowPreview } from '../../data/parquetRows'
import type { ParquetStructure } from '../../data/parquetStructure'
import {
  createStructuredLoadError,
  type StructuredLoadError,
} from '../errors/loadErrorModel'

export type ParquetRowsState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly preview: ParquetRowPreview }
  | { readonly status: 'error'; readonly error: StructuredLoadError }

export type ParquetRowsReader = (
  structure: ParquetStructure,
  signal: AbortSignal,
) => Promise<ParquetRowPreview>

// Rows are read as soon as the Rows view opens when the most they can cost
// is this; past it, on request.
export const AUTO_READ_ROWS_BYTES = 8_000_000

// The first rows of a file, read on request and kept while the file is open.
export function useParquetRows(structure: ParquetStructure, readRows: ParquetRowsReader) {
  const [state, setState] = useState<ParquetRowsState>({ status: 'idle' })
  const controllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => {
      controllerRef.current?.abort()
    }
  }, [])

  const read = useCallback(() => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setState({ status: 'loading' })

    readRows(structure, controller.signal).then(
      (preview) => {
        if (!controller.signal.aborted) setState({ status: 'ready', preview })
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        setState({
          status: 'error',
          error: createStructuredLoadError('Store structure', error),
        })
      },
    )
  }, [readRows, structure])

  return { state, read }
}
