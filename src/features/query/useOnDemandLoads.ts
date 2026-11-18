import { useEffect, useMemo, useRef, useState } from 'react'
import type { AppendDebugEvent } from '../app-shell/appRuntimeModel'

// Values the Cell Query window reads the first time a condition or column
// uses them (plan 23-D2), such as a dataset set Clusters has not loaded or a
// metadata track's values, kept for the dataset. Another dataset starts
// empty and stops the reads in flight.

export type OnDemandLoad<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly value: T }
  | { readonly status: 'error'; readonly message: string }

const LOADING = { status: 'loading' } as const

export function useOnDemandLoads<T>({
  enabled,
  datasetUrl,
  keys,
  load,
  describe,
  appendDebugEvent,
}: {
  readonly enabled: boolean
  readonly datasetUrl: string | null
  // What is needed now; keys read before stay.
  readonly keys: readonly string[]
  readonly load: (url: string, key: string, signal: AbortSignal) => Promise<T>
  // Names a key in the debug log, such as "annotation set leiden".
  readonly describe: (key: string) => string
  readonly appendDebugEvent: AppendDebugEvent
}): ReadonlyMap<string, OnDemandLoad<T>> {
  const [results, setResults] = useState<{
    readonly url: string | null
    readonly loads: ReadonlyMap<string, OnDemandLoad<T>>
  }>({ url: null, loads: new Map() })
  const inFlightRef = useRef(new Map<string, AbortController>())
  const keysKey = keys.join('\u0000')

  // Another dataset stops the reads for this one.
  useEffect(() => {
    const inFlight = inFlightRef.current

    return () => {
      for (const controller of inFlight.values()) controller.abort()
      inFlight.clear()
    }
  }, [datasetUrl])

  useEffect(() => {
    if (!enabled || datasetUrl === null) return

    const inFlight = inFlightRef.current
    const known = results.url === datasetUrl ? results.loads : null

    for (const key of keysKey === '' ? [] : keysKey.split('\u0000')) {
      if (known?.has(key) === true || inFlight.has(key)) continue

      const controller = new AbortController()
      inFlight.set(key, controller)
      appendDebugEvent(`Cell query: reading ${describe(key)}`)

      const settle = (loaded: OnDemandLoad<T>) => {
        if (inFlight.get(key) !== controller) return
        inFlight.delete(key)
        setResults((current) => ({
          url: datasetUrl,
          loads: new Map(current.url === datasetUrl ? current.loads : []).set(
            key,
            loaded,
          ),
        }))
      }

      load(datasetUrl, key, controller.signal).then(
        (value) => {
          settle({ status: 'ready', value })
        },
        (error: unknown) => {
          if (controller.signal.aborted) return
          const message = error instanceof Error ? error.message : String(error)
          settle({ status: 'error', message })
          appendDebugEvent(`Cell query: ${describe(key)} failed: ${message}`)
        },
      )
    }
  }, [appendDebugEvent, datasetUrl, describe, enabled, keysKey, load, results])

  return useMemo(() => {
    const loads = results.url === datasetUrl ? results.loads : new Map()
    return new Map(keys.map((key) => [key, loads.get(key) ?? LOADING]))
  }, [datasetUrl, keys, results])
}
