import { useEffect, useRef } from 'react'
import type { AnalysisAnnotationGroupOption } from '../../data/analysisAnnotations'
import { NO_ANNOTATION_GROUP_ID } from '../../data/datasetAnnotations'
import type { Annotation, SpatialElementId } from '../../datasets/spatialDataset'
import { parseVisiumHdClusteringGroupId } from '../../datasets/visiumHdClusters'
import type { VisiumHdBinSizeMicrometers } from '../../datasets/visiumHdDataset'
import {
  IDLE_ANNOTATION_STATE,
  annotationGroupLoadFailed,
  annotationGroupLoadReady,
  annotationGroupLoadStarted,
  defaultAnnotationGroupId,
  type AnnotationGroupState,
  type AnnotationState,
} from '../annotations/annotationModel'
import type { DatasetLoadState } from '../dataset/datasetLoadModel'
import {
  createStructuredLoadError,
  type StructuredLoadError,
} from '../errors/loadErrorModel'
import type { SpatialDatasetLoader } from './appDependencies'
import { isAbortError, type DebugLogAppendOptions } from './appRuntimeModel'

// A Visium HD dataset's Space Ranger clusterings, which belong to one bin size
// each (visiumHdClusters.ts).
export interface VisiumHdAnnotationDataset {
  annotationGroups(
    binSizeMicrometers?: VisiumHdBinSizeMicrometers,
    options?: { readonly signal?: AbortSignal },
  ): Promise<readonly AnalysisAnnotationGroupOption[]>
  annotations(options?: {
    readonly groupId?: string
    readonly binSizeMicrometers?: VisiumHdBinSizeMicrometers
    readonly signal?: AbortSignal
  }): Promise<readonly Annotation<SpatialElementId>[]>
}

export function isVisiumHdAnnotationDataset(
  dataset: unknown,
): dataset is VisiumHdAnnotationDataset {
  return (
    typeof dataset === 'object' &&
    dataset !== null &&
    typeof (dataset as Partial<VisiumHdAnnotationDataset>).annotationGroups ===
      'function' &&
    typeof (dataset as Partial<VisiumHdAnnotationDataset>).annotations === 'function'
  )
}

interface Setter<T> {
  (value: T | ((current: T) => T)): void
}

interface UseVisiumHdAnnotationSetsWorkflowOptions {
  readonly appendDebugEvent: (message: string, options?: DebugLogAppendOptions) => void
  // The tier whose sets are listed: the selected bin size, or the one drawn
  // after a failed switch.
  readonly activeBinSize: VisiumHdBinSizeMicrometers | undefined
  readonly annotationState: AnnotationState<StructuredLoadError>
  readonly getSpatialDataset: SpatialDatasetLoader
  readonly isVisiumHdDataset: boolean
  readonly loadAnnotationGroup: (
    groupId: string,
    options?: { readonly switchColorMode?: boolean },
  ) => Promise<void>
  readonly loadState: DatasetLoadState<StructuredLoadError>
  readonly setAnnotationGroupState: Setter<AnnotationGroupState<StructuredLoadError>>
  readonly setAnnotationState: Setter<AnnotationState<StructuredLoadError>>
  readonly setSelectedAnnotationGroupId: Setter<string>
}

// Lists the active tier's annotation sets whenever the tier changes. A set
// loaded for another tier names bins this one does not have, so it is read
// again for this tier when the tier has the same clustering, and cleared when
// it does not (2 µm has none).
export function useVisiumHdAnnotationSetsWorkflow({
  appendDebugEvent,
  activeBinSize,
  annotationState,
  getSpatialDataset,
  isVisiumHdDataset,
  loadAnnotationGroup,
  loadState,
  setAnnotationGroupState,
  setAnnotationState,
  setSelectedAnnotationGroupId,
}: UseVisiumHdAnnotationSetsWorkflowOptions): void {
  const readyUrl = loadState.status === 'ready' ? loadState.url : null
  // Read when the sets arrive, not when the tier changes.
  const latestRef = useRef({ annotationState, loadAnnotationGroup })

  useEffect(() => {
    latestRef.current = { annotationState, loadAnnotationGroup }
  }, [annotationState, loadAnnotationGroup])

  useEffect(() => {
    if (!isVisiumHdDataset || readyUrl === null || activeBinSize === undefined) {
      return
    }

    const controller = new AbortController()
    setAnnotationGroupState(annotationGroupLoadStarted(readyUrl))

    void getSpatialDataset(readyUrl)
      .then((dataset) =>
        isVisiumHdAnnotationDataset(dataset)
          ? dataset.annotationGroups(activeBinSize, { signal: controller.signal })
          : [],
      )
      .then((groups) => {
        if (controller.signal.aborted) {
          return
        }

        setAnnotationGroupState(annotationGroupLoadReady(readyUrl, groups))
        setSelectedAnnotationGroupId((current) =>
          groups.some((group) => group.id === current)
            ? current
            : (sameClusteringGroupId(current, groups) ??
              defaultAnnotationGroupId(groups) ??
              NO_ANNOTATION_GROUP_ID),
        )
        appendDebugEvent(
          `Visium HD ${activeBinSize} µm annotation sets ready: ${groups.length.toLocaleString()}`,
        )

        const { annotationState: loaded, loadAnnotationGroup: load } = latestRef.current
        const loadedGroup =
          loaded.status === 'ready' && loaded.groupId !== undefined
            ? parseVisiumHdClusteringGroupId(loaded.groupId)
            : null

        if (loadedGroup === null || loadedGroup.binSizeMicrometers === activeBinSize) {
          return
        }

        const nextGroupId = sameClusteringGroupId(
          loaded.status === 'ready' ? loaded.groupId : undefined,
          groups,
        )

        if (nextGroupId === undefined) {
          setAnnotationState(IDLE_ANNOTATION_STATE)
          return
        }

        setSelectedAnnotationGroupId(nextGroupId)
        void load(nextGroupId, { switchColorMode: false })
      })
      .catch((error: unknown) => {
        if (isAbortError(error) || controller.signal.aborted) {
          return
        }

        setAnnotationGroupState(
          annotationGroupLoadFailed(
            readyUrl,
            createStructuredLoadError('Annotations', error),
          ),
        )
        appendDebugEvent('Visium HD annotation sets failed')
      })

    return () => {
      controller.abort()
    }
  }, [
    activeBinSize,
    appendDebugEvent,
    getSpatialDataset,
    isVisiumHdDataset,
    readyUrl,
    setAnnotationGroupState,
    setAnnotationState,
    setSelectedAnnotationGroupId,
  ])
}

// The set in `groups` with the same clustering as `groupId`, which may be
// another tier's.
function sameClusteringGroupId(
  groupId: string | undefined,
  groups: readonly AnalysisAnnotationGroupOption[],
): string | undefined {
  const group = groupId === undefined ? null : parseVisiumHdClusteringGroupId(groupId)

  return group === null
    ? undefined
    : groups.find((candidate) => candidate.groupingName === group.clustering)?.id
}
