import { useEffect, useState } from 'react'
import type { AnnotationLoader } from '../app-shell/appDependencies'
import { isAbortError, type AppendDebugEvent } from '../app-shell/appRuntimeModel'
import { colorsForAnnotations } from '../annotations/annotationModel'
import type { PlotDatasetSetState } from './plotsPanelModel'

// The classes of a dataset set chosen in Group by that Cells › Clusters has
// not loaded, read for the plot alone so the map keeps its colours. One set
// is kept at a time.

type SettledState = Exclude<PlotDatasetSetState, { readonly status: 'loading' }>

export function useDatasetSetAnnotations({
  enabled,
  datasetUrl,
  groupId,
  loadAnnotations,
  appendDebugEvent,
}: {
  readonly enabled: boolean
  readonly datasetUrl: string | null
  // The dataset group Group by shows, or null for another kind of set.
  readonly groupId: string | null
  readonly loadAnnotations: AnnotationLoader
  readonly appendDebugEvent: AppendDebugEvent
}): PlotDatasetSetState | null {
  const [settled, setSettled] = useState<{
    readonly url: string
    readonly state: SettledState
  } | null>(null)
  const current =
    settled !== null && settled.url === datasetUrl && settled.state.groupId === groupId
      ? settled.state
      : null

  useEffect(() => {
    if (!enabled || datasetUrl === null || groupId === null || current !== null) return

    const controller = new AbortController()
    appendDebugEvent(`Plots: reading annotation set ${groupId}`)

    loadAnnotations(datasetUrl, { signal: controller.signal, groupId }).then(
      (annotations) => {
        if (controller.signal.aborted) return
        // Stored colours, else the palette from its start, as Clusters gives
        // a set loaded first.
        setSettled({
          url: datasetUrl,
          state: {
            groupId,
            status: 'ready',
            annotations,
            colors: colorsForAnnotations(annotations, {}),
          },
        })
        appendDebugEvent(
          `Plots: annotation set ${groupId} ready: ${annotations.length.toLocaleString()} classes`,
        )
      },
      (error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return
        const message = error instanceof Error ? error.message : String(error)
        setSettled({ url: datasetUrl, state: { groupId, status: 'error', message } })
        appendDebugEvent(`Plots: annotation set ${groupId} failed: ${message}`)
      },
    )

    return () => {
      controller.abort()
    }
  }, [appendDebugEvent, current, datasetUrl, enabled, groupId, loadAnnotations])

  if (groupId === null) return null
  return current ?? { groupId, status: 'loading' }
}
