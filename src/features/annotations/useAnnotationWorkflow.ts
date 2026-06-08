import { useCallback, type Dispatch, type SetStateAction } from 'react'
import { parseCustomAnnotations } from '../../data/customAnnotations'
import { ALL_ANNOTATION_GROUP_ID } from '../../data/datasetAnnotations'
import type { Annotation } from '../../datasets/spatialDataset'
import {
  annotationPaletteColor,
  normalizeAnnotationColor,
} from '../../rendering/annotationPalette'
import type { ObservationColorMode } from '../../rendering/cellStyling'
import { slug } from '../../utils/slug'
import type { AnnotationLoader } from '../app-shell/appDependencies'
import {
  isAbortError,
  shortIdentifier,
  type DebugLogAppendOptions,
} from '../app-shell/appRuntimeModel'
import type { DatasetLoadState } from '../dataset/datasetLoadModel'
import {
  createStructuredLoadError,
  type StructuredLoadError,
} from '../errors/loadErrorModel'
import { defaultRoiName, type RoiState } from '../roi/roiModel'
import {
  colorsForAnnotations,
  customAnnotationFilePrefix,
  hasReadyAnnotationsAfterRemove,
  mergeImportedAnnotations,
  removeAnnotationColor,
  removeAnnotationColorsByPrefix,
  type AnnotationState,
} from './annotationModel'

interface MutableRef<T> {
  current: T
}

interface UseAnnotationWorkflowOptions {
  readonly annotationState: AnnotationState<StructuredLoadError>
  readonly appendDebugEvent: (message: string, options?: DebugLogAppendOptions) => void
  readonly datasetAbortRef: MutableRef<AbortController | null>
  readonly datasetUrl: string
  readonly loadAnnotations: AnnotationLoader
  readonly loadRequestIdRef: MutableRef<number>
  readonly loadState: DatasetLoadState<StructuredLoadError>
  readonly roiIdRef: MutableRef<number>
  readonly roiName: string
  readonly roiState: RoiState<StructuredLoadError>
  readonly selectedAnnotationGroupId: string
  readonly setAnnotationColors: Dispatch<SetStateAction<Readonly<Record<string, string>>>>
  readonly setAnnotationState: Dispatch<
    SetStateAction<AnnotationState<StructuredLoadError>>
  >
  readonly setObservationColorMode: Dispatch<SetStateAction<ObservationColorMode>>
  readonly setRoiName: Dispatch<SetStateAction<string>>
  readonly setSelectedAnnotationGroupId: Dispatch<SetStateAction<string>>
}

interface UseAnnotationWorkflowResult {
  readonly handleAnnotationColorChange: (annotationId: string, color: string) => void
  readonly handleAnnotationGroupChange: (groupId: string) => void
  readonly handleClearAnnotations: () => void
  readonly handleImportAnnotations: (file: File | null) => Promise<void>
  readonly handleLoadAnnotations: () => void
  readonly handleRemoveAnnotation: (annotationId: string) => void
  readonly handleSaveRoiAnnotation: () => void
}

export function useAnnotationWorkflow({
  annotationState,
  appendDebugEvent,
  datasetAbortRef,
  datasetUrl,
  loadAnnotations,
  loadRequestIdRef,
  loadState,
  roiIdRef,
  roiName,
  roiState,
  selectedAnnotationGroupId,
  setAnnotationColors,
  setAnnotationState,
  setObservationColorMode,
  setRoiName,
  setSelectedAnnotationGroupId,
}: UseAnnotationWorkflowOptions): UseAnnotationWorkflowResult {
  const handleLoadAnnotations = useCallback(() => {
    if (loadState.status !== 'ready' || annotationState.status === 'loading') {
      return
    }

    const requestId = loadRequestIdRef.current
    const signal = datasetAbortRef.current?.signal
    const groupId =
      selectedAnnotationGroupId === ALL_ANNOTATION_GROUP_ID
        ? undefined
        : selectedAnnotationGroupId
    appendDebugEvent(
      groupId === undefined ? 'Loading annotations' : `Loading annotations ${groupId}`,
    )
    setAnnotationState({ status: 'loading', url: loadState.url })

    void loadAnnotations(loadState.url, {
      ...(signal === undefined ? {} : { signal }),
      ...(groupId === undefined ? {} : { groupId }),
    })
      .then((annotations) => {
        if (loadRequestIdRef.current !== requestId) {
          return
        }

        setAnnotationState({
          status: 'ready',
          url: loadState.url,
          annotations,
        })
        setAnnotationColors((current) => colorsForAnnotations(annotations, current))
        if (annotations.length > 0) {
          setObservationColorMode('annotations')
        }
        appendDebugEvent(
          `Annotations loaded: ${annotations.length.toLocaleString()} labels`,
        )
      })
      .catch((error) => {
        if (isAbortError(error) || loadRequestIdRef.current !== requestId) {
          return
        }

        setAnnotationState({
          status: 'error',
          url: loadState.url,
          error: createStructuredLoadError('Annotations', error),
        })
        appendDebugEvent('Annotations failed')
      })
  }, [
    annotationState,
    appendDebugEvent,
    datasetAbortRef,
    loadAnnotations,
    loadRequestIdRef,
    loadState,
    selectedAnnotationGroupId,
    setAnnotationColors,
    setAnnotationState,
    setObservationColorMode,
  ])

  const handleAnnotationGroupChange = useCallback(
    (nextGroupId: string) => {
      setSelectedAnnotationGroupId(nextGroupId)
      appendDebugEvent(`Annotation set: ${shortIdentifier(nextGroupId)}`)
    },
    [appendDebugEvent, setSelectedAnnotationGroupId],
  )

  const handleImportAnnotations = useCallback(
    async (file: File | null) => {
      if (file === null) {
        return
      }

      try {
        const importedAnnotations = parseCustomAnnotations(await file.text(), file.name)
        const importedPrefix = customAnnotationFilePrefix(file.name)

        setAnnotationState((current) => ({
          status: 'ready',
          url: loadState.status === 'ready' ? loadState.url : datasetUrl,
          annotations: mergeImportedAnnotations(
            current.status === 'ready' ? current.annotations : [],
            importedAnnotations,
            importedPrefix,
          ),
        }))
        setAnnotationColors((current) =>
          colorsForAnnotations(
            importedAnnotations,
            removeAnnotationColorsByPrefix(current, importedPrefix),
          ),
        )
        if (importedAnnotations.length > 0) {
          setObservationColorMode('annotations')
        }
        appendDebugEvent(
          `Imported annotations: ${importedAnnotations.length.toLocaleString()} labels`,
        )
      } catch (error) {
        setAnnotationState({
          status: 'error',
          url: loadState.status === 'ready' ? loadState.url : datasetUrl,
          error: createStructuredLoadError('Annotations', error),
        })
        appendDebugEvent('Annotation import failed')
      }
    },
    [
      appendDebugEvent,
      datasetUrl,
      loadState,
      setAnnotationColors,
      setAnnotationState,
      setObservationColorMode,
    ],
  )

  const handleAnnotationColorChange = useCallback(
    (annotationId: string, color: string) => {
      const normalizedColor = normalizeAnnotationColor(color)

      if (normalizedColor === null) {
        return
      }

      setAnnotationColors((current) => ({ ...current, [annotationId]: normalizedColor }))
      appendDebugEvent(`Annotation color ${shortIdentifier(annotationId)}`, {
        coalesceKey: `annotation-color:${annotationId}`,
      })
    },
    [appendDebugEvent, setAnnotationColors],
  )

  const handleRemoveAnnotation = useCallback(
    (annotationId: string) => {
      const removedAnnotation =
        annotationState.status === 'ready'
          ? annotationState.annotations.find(
              (annotation) => annotation.id === annotationId,
            )
          : undefined

      setAnnotationState((current) => {
        if (current.status !== 'ready') {
          return current
        }

        const annotations = current.annotations.filter(
          (annotation) => annotation.id !== annotationId,
        )

        return annotations.length === 0 ? { status: 'idle' } : { ...current, annotations }
      })
      setAnnotationColors((current) => removeAnnotationColor(current, annotationId))
      setObservationColorMode((current) =>
        hasReadyAnnotationsAfterRemove(annotationState, annotationId)
          ? current
          : 'transcript-count',
      )

      appendDebugEvent(
        `Removed annotation ${removedAnnotation?.label ?? shortIdentifier(annotationId)}`,
      )
    },
    [
      annotationState,
      appendDebugEvent,
      setAnnotationColors,
      setAnnotationState,
      setObservationColorMode,
    ],
  )

  const handleClearAnnotations = useCallback(() => {
    setAnnotationState({ status: 'idle' })
    setAnnotationColors({})
    setObservationColorMode('transcript-count')
    appendDebugEvent('Cleared annotations')
  }, [appendDebugEvent, setAnnotationColors, setAnnotationState, setObservationColorMode])

  const handleSaveRoiAnnotation = useCallback(() => {
    if (loadState.status !== 'ready' || roiState.status !== 'ready') {
      return
    }

    const name = roiName.trim() || defaultRoiName(roiIdRef.current + 1)
    const annotation: Annotation = {
      id: `roi:${roiIdRef.current + 1}:${slug(name)}`,
      label: name,
      cellIds: roiState.cells.map((cell) => cell.id),
    }

    roiIdRef.current += 1
    appendDebugEvent(`Saved ROI annotation ${name}`)
    setAnnotationState((current) => ({
      status: 'ready',
      url: loadState.url,
      annotations: [
        annotation,
        ...(current.status === 'ready' ? current.annotations : []),
      ],
    }))
    setAnnotationColors((current) => ({
      ...current,
      [annotation.id]: annotationPaletteColor(Object.keys(current).length),
    }))
    setObservationColorMode('annotations')
    setRoiName(defaultRoiName(roiIdRef.current + 1))
  }, [
    appendDebugEvent,
    loadState,
    roiIdRef,
    roiName,
    roiState,
    setAnnotationColors,
    setAnnotationState,
    setObservationColorMode,
    setRoiName,
  ])

  return {
    handleAnnotationColorChange,
    handleAnnotationGroupChange,
    handleClearAnnotations,
    handleImportAnnotations,
    handleLoadAnnotations,
    handleRemoveAnnotation,
    handleSaveRoiAnnotation,
  }
}
