import { useCallback, type Dispatch, type SetStateAction } from 'react'
import {
  customCellMetadataFilePrefix,
  parseCustomAnnotationImport,
  type ContinuousCellMetadataTrack,
} from '../../data/customAnnotations'
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
  downloadTextFile,
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
  annotationsToCsv,
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
  readonly cellMetadataTracks: readonly ContinuousCellMetadataTrack[]
  readonly loadAnnotations: AnnotationLoader
  readonly loadRequestIdRef: MutableRef<number>
  readonly loadState: DatasetLoadState<StructuredLoadError>
  readonly roiIdRef: MutableRef<number>
  readonly roiName: string
  readonly roiState: RoiState<StructuredLoadError>
  readonly selectedAnnotationGroupId: string
  readonly setAnnotationColors: Dispatch<SetStateAction<Readonly<Record<string, string>>>>
  readonly setHiddenAnnotationSetIds: Dispatch<SetStateAction<readonly string[]>>
  readonly setCellMetadataTracks: Dispatch<
    SetStateAction<readonly ContinuousCellMetadataTrack[]>
  >
  readonly setAnnotationState: Dispatch<
    SetStateAction<AnnotationState<StructuredLoadError>>
  >
  readonly setObservationColorMode: Dispatch<SetStateAction<ObservationColorMode>>
  readonly setRoiName: Dispatch<SetStateAction<string>>
  readonly setSelectedAnnotationGroupId: Dispatch<SetStateAction<string>>
  readonly setSelectedCellMetadataTrackId: Dispatch<SetStateAction<string | null>>
}

interface UseAnnotationWorkflowResult {
  readonly handleAnnotationColorChange: (annotationId: string, color: string) => void
  readonly handleAnnotationGroupChange: (groupId: string) => void
  readonly handleClearAnnotations: () => void
  readonly handleExportAnnotations: () => void
  readonly handleImportAnnotations: (file: File | null) => Promise<void>
  readonly handleImportAnnotationUrl: (url: string) => Promise<boolean>
  readonly handleLoadAnnotations: () => void
  readonly handleRemoveCellMetadataTrack: (trackId: string) => void
  readonly handleRemoveAnnotation: (annotationId: string) => void
  readonly handleSaveRoiAnnotation: () => void
}

interface AnnotationImportUrl {
  readonly sourceName: string
  readonly url: string
}

export function useAnnotationWorkflow({
  annotationState,
  appendDebugEvent,
  cellMetadataTracks,
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
  setHiddenAnnotationSetIds,
  setCellMetadataTracks,
  setAnnotationState,
  setObservationColorMode,
  setRoiName,
  setSelectedAnnotationGroupId,
  setSelectedCellMetadataTrackId,
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

  const importCustomAnnotationText = useCallback(
    (text: string, sourceName: string, sourceLabel: string) => {
      const { annotations: importedAnnotations, metadataTracks: importedMetadataTracks } =
        parseCustomAnnotationImport(text, sourceName)
      const importedPrefix = customAnnotationFilePrefix(sourceName)
      const importedMetadataPrefix = customCellMetadataFilePrefix(sourceName)
      const nextCellMetadataTracks = mergeImportedCellMetadataTracks(
        cellMetadataTracks,
        importedMetadataTracks,
        importedMetadataPrefix,
      )

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
      setCellMetadataTracks(nextCellMetadataTracks)
      setSelectedCellMetadataTrackId((current) => {
        if (nextCellMetadataTracks.length === 0) {
          return null
        }

        if (
          current !== null &&
          nextCellMetadataTracks.some((track) => track.id === current)
        ) {
          return current
        }

        return importedMetadataTracks[0]?.id ?? nextCellMetadataTracks[0]?.id ?? null
      })
      if (importedAnnotations.length > 0) {
        setObservationColorMode('annotations')
      } else if (importedMetadataTracks.length > 0) {
        setObservationColorMode('metadata')
      }
      appendDebugEvent(
        importedMetadataTracks.length === 0
          ? `${sourceLabel}: ${importedAnnotations.length.toLocaleString()} labels`
          : `${sourceLabel}: ${importedAnnotations.length.toLocaleString()} labels, ${importedMetadataTracks.length.toLocaleString()} metadata tracks`,
      )
    },
    [
      appendDebugEvent,
      cellMetadataTracks,
      datasetUrl,
      loadState,
      setAnnotationColors,
      setAnnotationState,
      setCellMetadataTracks,
      setObservationColorMode,
      setSelectedCellMetadataTrackId,
    ],
  )

  const handleImportAnnotations = useCallback(
    async (file: File | null) => {
      if (file === null) {
        return
      }

      try {
        importCustomAnnotationText(await file.text(), file.name, 'Imported annotations')
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
      importCustomAnnotationText,
      loadState,
      setAnnotationState,
    ],
  )

  const handleImportAnnotationUrl = useCallback(
    async (url: string) => {
      const requestId = loadRequestIdRef.current

      try {
        const { sourceName, url: fetchUrl } = annotationImportUrl(url)
        appendDebugEvent(`Importing annotation URL ${shortIdentifier(sourceName)}`)
        const signal = datasetAbortRef.current?.signal
        const response = await fetch(
          fetchUrl,
          signal === undefined ? undefined : { signal },
        )

        if (!response.ok) {
          throw new Error(`Annotation URL returned HTTP ${response.status}.`)
        }

        const text = await response.text()

        if (loadRequestIdRef.current !== requestId) {
          return false
        }

        importCustomAnnotationText(text, sourceName, 'Imported URL annotations')
        return true
      } catch (error) {
        if (isAbortError(error) || loadRequestIdRef.current !== requestId) {
          return false
        }

        setAnnotationState({
          status: 'error',
          url: loadState.status === 'ready' ? loadState.url : datasetUrl,
          error: createStructuredLoadError('Annotations', error),
        })
        appendDebugEvent('Annotation URL import failed')
        return false
      }
    },
    [
      appendDebugEvent,
      datasetAbortRef,
      datasetUrl,
      importCustomAnnotationText,
      loadRequestIdRef,
      loadState,
      setAnnotationState,
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
          : cellMetadataTracks.length > 0
            ? 'metadata'
            : 'transcript-count',
      )

      appendDebugEvent(
        `Removed annotation ${removedAnnotation?.label ?? shortIdentifier(annotationId)}`,
      )
    },
    [
      annotationState,
      appendDebugEvent,
      cellMetadataTracks,
      setAnnotationColors,
      setAnnotationState,
      setObservationColorMode,
    ],
  )

  const handleRemoveCellMetadataTrack = useCallback(
    (trackId: string) => {
      const removedTrack = cellMetadataTracks.find((track) => track.id === trackId)
      const nextCellMetadataTracks = cellMetadataTracks.filter(
        (track) => track.id !== trackId,
      )

      setCellMetadataTracks(nextCellMetadataTracks)
      setSelectedCellMetadataTrackId((current) => {
        if (nextCellMetadataTracks.length === 0) {
          return null
        }

        if (
          current !== null &&
          current !== trackId &&
          nextCellMetadataTracks.some((track) => track.id === current)
        ) {
          return current
        }

        return nextCellMetadataTracks[0]?.id ?? null
      })
      setObservationColorMode((current) =>
        current === 'metadata' && nextCellMetadataTracks.length === 0
          ? 'transcript-count'
          : current,
      )
      appendDebugEvent(
        `Removed metadata track ${removedTrack?.label ?? shortIdentifier(trackId)}`,
      )
    },
    [
      appendDebugEvent,
      cellMetadataTracks,
      setCellMetadataTracks,
      setObservationColorMode,
      setSelectedCellMetadataTrackId,
    ],
  )

  const handleClearAnnotations = useCallback(() => {
    setAnnotationState({ status: 'idle' })
    setAnnotationColors({})
    setHiddenAnnotationSetIds([])
    setCellMetadataTracks([])
    setSelectedCellMetadataTrackId(null)
    setObservationColorMode('transcript-count')
    appendDebugEvent('Cleared annotations')
  }, [
    appendDebugEvent,
    setAnnotationColors,
    setAnnotationState,
    setHiddenAnnotationSetIds,
    setCellMetadataTracks,
    setObservationColorMode,
    setSelectedCellMetadataTrackId,
  ])

  const handleExportAnnotations = useCallback(() => {
    if (annotationState.status !== 'ready' || annotationState.annotations.length === 0) {
      return
    }

    downloadTextFile('annotations.csv', annotationsToCsv(annotationState.annotations))
    appendDebugEvent(
      `Exported annotations: ${annotationState.annotations.length.toLocaleString()} labels`,
    )
  }, [annotationState, appendDebugEvent])

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
    handleExportAnnotations,
    handleImportAnnotations,
    handleImportAnnotationUrl,
    handleLoadAnnotations,
    handleRemoveCellMetadataTrack,
    handleRemoveAnnotation,
    handleSaveRoiAnnotation,
  }
}

function mergeImportedCellMetadataTracks(
  currentTracks: readonly ContinuousCellMetadataTrack[],
  importedTracks: readonly ContinuousCellMetadataTrack[],
  importedPrefix: string,
): readonly ContinuousCellMetadataTrack[] {
  return [
    ...currentTracks.filter((track) => !track.id.startsWith(importedPrefix)),
    ...importedTracks,
  ]
}

function annotationImportUrl(rawUrl: string): AnnotationImportUrl {
  const trimmedUrl = rawUrl.trim()
  const url = normalizeAnnotationFetchUrl(new URL(trimmedUrl))

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Annotation URL must start with http:// or https://.')
  }

  return {
    sourceName: annotationSourceNameFromUrl(url),
    url: url.toString(),
  }
}

function normalizeAnnotationFetchUrl(url: URL): URL {
  if (url.hostname !== 'github.com') {
    return url
  }

  const segments = url.pathname.split('/').filter((segment) => segment.length > 0)
  const [owner, repo, action, branch, ...pathParts] = segments

  if (
    owner === undefined ||
    repo === undefined ||
    branch === undefined ||
    pathParts.length === 0 ||
    (action !== 'blob' && action !== 'raw')
  ) {
    return url
  }

  return new URL(
    `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${pathParts
      .map(encodeURIComponent)
      .join('/')}`,
  )
}

function annotationSourceNameFromUrl(url: URL): string {
  const lastSegment = url.pathname
    .split('/')
    .filter((segment) => segment.length > 0)
    .at(-1)

  if (lastSegment === undefined) {
    return url.hostname
  }

  try {
    return decodeURIComponent(lastSegment)
  } catch {
    return lastSegment
  }
}
