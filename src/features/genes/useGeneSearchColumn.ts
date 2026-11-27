import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import { isAbortError } from '../../utils/abort'
import type { AppendDebugEvent } from '../app-shell/appRuntimeModel'
import type { StructuredLoadError } from '../errors/loadErrorModel'
import {
  genePanelSearchColumnFailed,
  genePanelSearchColumnReady,
  genePanelSearchColumnStarted,
  type GenePanelState,
} from './geneControlsModel'

// Gene name to its value in a var column of the dataset at `baseUrl`.
export type GeneSearchAliasesLoader = (
  baseUrl: string,
  column: string,
  options?: { readonly signal?: AbortSignal },
) => Promise<ReadonlyMap<string, string>>

interface UseGeneSearchColumnOptions {
  readonly appendDebugEvent: AppendDebugEvent
  readonly genePanelState: GenePanelState<StructuredLoadError>
  readonly loadGeneSearchAliases: GeneSearchAliasesLoader
  readonly setGenePanelState: Dispatch<
    SetStateAction<GenePanelState<StructuredLoadError>>
  >
}

// Changes the var column the gene search matches besides the names (null for
// none). A column picked while another is read replaces it, and a new gene
// panel stops the read.
export function useGeneSearchColumn({
  appendDebugEvent,
  genePanelState,
  loadGeneSearchAliases,
  setGenePanelState,
}: UseGeneSearchColumnOptions): (column: string | null) => void {
  const readRef = useRef<AbortController | null>(null)
  const url = genePanelState.status === 'ready' ? genePanelState.url : null

  useEffect(
    () => () => {
      readRef.current?.abort()
      readRef.current = null
    },
    [url],
  )

  return useCallback(
    (column: string | null) => {
      if (url === null) {
        return
      }

      readRef.current?.abort()
      readRef.current = null
      setGenePanelState((current) => genePanelSearchColumnStarted(current, url, column))

      if (column === null) {
        appendDebugEvent('Gene search: names only')
        return
      }

      const read = new AbortController()
      readRef.current = read
      appendDebugEvent(`Reading gene search column ${column}`)
      void loadGeneSearchAliases(url, column, { signal: read.signal })
        .then((aliases) => {
          if (read.signal.aborted) return

          readRef.current = null
          setGenePanelState((current) =>
            genePanelSearchColumnReady(current, url, column, aliases),
          )
          appendDebugEvent(`Gene search column ready: ${column}`)
        })
        .catch((error: unknown) => {
          if (read.signal.aborted || isAbortError(error)) return

          const message = error instanceof Error ? error.message : String(error)
          readRef.current = null
          setGenePanelState((current) =>
            genePanelSearchColumnFailed(
              current,
              url,
              column,
              `Could not read ${column}: ${message}`,
            ),
          )
          appendDebugEvent(`Gene search column failed: ${column}: ${message}`)
        })
    },
    [appendDebugEvent, loadGeneSearchAliases, setGenePanelState, url],
  )
}
