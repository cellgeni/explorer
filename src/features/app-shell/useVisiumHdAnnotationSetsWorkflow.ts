import { useEffect, useRef, useState } from 'react'
import {
  ALL_ANNOTATION_GROUP_ID,
  NO_ANNOTATION_GROUP_ID,
} from '../../data/datasetAnnotations'
import type { SpatialElementId } from '../../datasets/spatialDataset'
import { parseVisiumHdSquareBarcode } from '../../datasets/visiumHdBarcodes'
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
import type { Annotation, AnnotationGroupOption } from '../../data/annotation'

// A Visium HD dataset's Space Ranger clusterings, which belong to one bin size
// each (visiumHdClusters.ts).
export interface VisiumHdAnnotationDataset {
  annotationGroups(
    binSizeMicrometers?: VisiumHdBinSizeMicrometers,
    options?: { readonly signal?: AbortSignal },
  ): Promise<readonly AnnotationGroupOption[]>
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
  // Hidden classes, kept when a set is read again for another tier (class ids
  // leave out the tier).
  readonly hiddenAnnotationIds: readonly string[]
  readonly isVisiumHdDataset: boolean
  readonly loadAnnotationGroup: (
    groupId: string,
    options?: {
      readonly switchColorMode?: boolean
      readonly hiddenAnnotationIds?: readonly string[]
    },
  ) => Promise<void>
  readonly loadState: DatasetLoadState<StructuredLoadError>
  readonly setAnnotationGroupState: Setter<AnnotationGroupState<StructuredLoadError>>
  readonly setAnnotationState: Setter<AnnotationState<StructuredLoadError>>
  readonly setSelectedAnnotationGroupId: Setter<string>
}

// Lists the active tier's annotation sets whenever the tier changes. A set
// loaded for another tier names bins this one does not have, so once both the
// set and the tier's list are in, it is read again for this tier when the tier
// has the same clustering (or any, for "All"), and cleared when it does not
// (2 µm has none). That includes a set still loading when the tier changed.
export function useVisiumHdAnnotationSetsWorkflow({
  appendDebugEvent,
  activeBinSize,
  annotationState,
  getSpatialDataset,
  hiddenAnnotationIds,
  isVisiumHdDataset,
  loadAnnotationGroup,
  loadState,
  setAnnotationGroupState,
  setAnnotationState,
  setSelectedAnnotationGroupId,
}: UseVisiumHdAnnotationSetsWorkflowOptions): void {
  const readyUrl = loadState.status === 'ready' ? loadState.url : null
  // The sets listed for a tier, once they arrive.
  const [listed, setListed] = useState<{
    readonly url: string
    readonly binSize: VisiumHdBinSizeMicrometers
    readonly groups: readonly AnnotationGroupOption[]
  } | null>(null)
  const latestAnnotationStateRef = useRef(annotationState)

  useEffect(() => {
    latestAnnotationStateRef.current = annotationState
  }, [annotationState])

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
        // "All" stays selected while it is the set shown, if this tier has any.
        const allShown =
          groups.length > 0 &&
          loadedGroupId(latestAnnotationStateRef.current) === ALL_ANNOTATION_GROUP_ID
        setSelectedAnnotationGroupId((current) =>
          groups.some((group) => group.id === current) ||
          (allShown && current === ALL_ANNOTATION_GROUP_ID)
            ? current
            : (sameClusteringGroupId(current, groups) ??
              defaultAnnotationGroupId(groups) ??
              NO_ANNOTATION_GROUP_ID),
        )
        setListed({ url: readyUrl, binSize: activeBinSize, groups })
        appendDebugEvent(
          `Visium HD ${activeBinSize} µm annotation sets ready: ${groups.length.toLocaleString()}`,
        )
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
    setSelectedAnnotationGroupId,
  ])

  useEffect(() => {
    if (
      !isVisiumHdDataset ||
      listed === null ||
      listed.url !== readyUrl ||
      listed.binSize !== activeBinSize ||
      annotationState.status !== 'ready'
    ) {
      return
    }

    const groupId = annotationState.groupId
    const readBinSize = loadedSetBinSize(annotationState)

    if (readBinSize === undefined || readBinSize === activeBinSize) {
      return
    }

    const nextGroupId =
      groupId === ALL_ANNOTATION_GROUP_ID
        ? listed.groups.length > 0
          ? ALL_ANNOTATION_GROUP_ID
          : undefined
        : sameClusteringGroupId(groupId, listed.groups)

    if (nextGroupId === undefined) {
      setAnnotationState(IDLE_ANNOTATION_STATE)
      return
    }

    setSelectedAnnotationGroupId(nextGroupId)
    void loadAnnotationGroup(nextGroupId, {
      switchColorMode: false,
      hiddenAnnotationIds,
    })
  }, [
    activeBinSize,
    annotationState,
    hiddenAnnotationIds,
    isVisiumHdDataset,
    listed,
    loadAnnotationGroup,
    readyUrl,
    setAnnotationState,
    setSelectedAnnotationGroupId,
  ])
}

// The set a ready annotation state shows, if one was loaded.
function loadedGroupId(state: AnnotationState<StructuredLoadError>): string | undefined {
  return state.status === 'ready' ? state.groupId : undefined
}

// The tier whose bins a loaded set names. A set's id names its tier; "All" is
// read for the tier active when it was read, which its bin barcodes name.
function loadedSetBinSize(
  state: AnnotationState<StructuredLoadError>,
): VisiumHdBinSizeMicrometers | undefined {
  const groupId = loadedGroupId(state)

  if (state.status !== 'ready' || groupId === undefined) {
    return undefined
  }

  if (groupId !== ALL_ANNOTATION_GROUP_ID) {
    return parseVisiumHdClusteringGroupId(groupId)?.binSizeMicrometers
  }

  const barcode = state.annotations.find((annotation) => annotation.cellIds.length > 0)
    ?.cellIds[0]

  return barcode === undefined
    ? undefined
    : parseVisiumHdSquareBarcode(barcode)?.binSizeMicrometers
}

// The set in `groups` with the same clustering as `groupId`, which may be
// another tier's.
function sameClusteringGroupId(
  groupId: string | undefined,
  groups: readonly AnnotationGroupOption[],
): string | undefined {
  const group = groupId === undefined ? null : parseVisiumHdClusteringGroupId(groupId)

  return group === null
    ? undefined
    : groups.find((candidate) => candidate.groupingName === group.clustering)?.id
}
