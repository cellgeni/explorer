import { useCallback, useEffect, useRef, useState } from 'react'
import {
  clearCachedExamples,
  EXAMPLES_INDEX_URL,
  fetchExamplesIndex,
  readCachedExamples,
  sessionStorageOrNull,
  writeCachedExamples,
  type Example,
} from './examplesIndex'

export type ExamplesState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly examples: readonly Example[] }
  | { readonly status: 'error'; readonly message: string }

export interface ExamplesIndexStore {
  readonly state: ExamplesState
  // Fetches the index unless it is loaded or loading. The start screen calls
  // it when it opens, and the dataset menu when it opens.
  readonly load: () => void
  // Fetches again, skipping the session's copy.
  readonly retry: () => void
}

interface UseExamplesIndexOptions {
  readonly url?: string
  readonly loadIndex?: (
    url: string,
    options: { readonly signal: AbortSignal },
  ) => Promise<readonly Example[]>
}

export function useExamplesIndex({
  url = EXAMPLES_INDEX_URL,
  loadIndex = fetchExamplesIndex,
}: UseExamplesIndexOptions = {}): ExamplesIndexStore {
  const [state, setState] = useState<ExamplesState>(() => {
    const cached = readCachedExamples(sessionStorageOrNull(), url)
    return cached === null ? { status: 'idle' } : { status: 'ready', examples: cached }
  })
  const stateRef = useRef(state)
  const controllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    return () => {
      controllerRef.current?.abort()
    }
  }, [])

  const start = useCallback(() => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    stateRef.current = { status: 'loading' }
    setState(stateRef.current)

    loadIndex(url, { signal: controller.signal }).then(
      (examples) => {
        if (controller.signal.aborted) return
        writeCachedExamples(sessionStorageOrNull(), url, examples)
        setState({ status: 'ready', examples })
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
        })
      },
    )
  }, [loadIndex, url])

  const load = useCallback(() => {
    const status = stateRef.current.status
    if (status === 'idle' || status === 'error') start()
  }, [start])

  const retry = useCallback(() => {
    clearCachedExamples(sessionStorageOrNull(), url)
    start()
  }, [start, url])

  return { state, load, retry }
}
