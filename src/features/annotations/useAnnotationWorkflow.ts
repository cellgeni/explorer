import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'
import {
  customCellMetadataFilePrefix,
  parseCustomAnnotationImport,
  type ContinuousCellMetadataTrack,
} from '../../data/customAnnotations'
import {
  ALL_ANNOTATION_GROUP_ID,
  NO_ANNOTATION_GROUP_ID,
} from '../../data/datasetAnnotations'
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
  IDLE_ANNOTATION_STATE,
  annotationLoadFailed,
  annotationLoadReady,
  annotationLoadStarted,
  annotationsToCsv,
  colorsForAnnotations,
  customAnnotationFilePrefix,
  hasReadyAnnotationsAfterRemove,
  mergeImportedAnnotations,
  removeAnnotationColor,
  removeAnnotationColorsByPrefix,
  removeHiddenAnnotationIdsByPrefix,
  type AnnotationState,
} from './annotationModel'

interface MutableRef<T> {
  current: T
}

interface AnnotationWorkflowCallbacks {
  readonly appendDebugEvent: (message: string, options?: DebugLogAppendOptions) => void
}

// The cells on the map, which imported cell IDs are checked against.
interface DatasetCellIds {
  has(cellId: string): boolean
  readonly size: number
}

interface AnnotationWorkflowData {
  readonly annotationState: AnnotationState<StructuredLoadError>
  readonly cellMetadataTracks: readonly ContinuousCellMetadataTrack[]
  // Empty until the dataset's cells are read, when imports are not checked.
  readonly datasetCellIds: DatasetCellIds
  readonly datasetUrl: string
  readonly loadState: DatasetLoadState<StructuredLoadError>
  readonly roiName: string
  readonly roiState: RoiState<StructuredLoadError>
  readonly selectedAnnotationGroupId: string
}

interface AnnotationWorkflowLoaders {
  readonly loadAnnotations: AnnotationLoader
}

interface AnnotationWorkflowRefs {
  readonly datasetAbortRef: MutableRef<AbortController | null>
  readonly loadRequestIdRef: MutableRef<number>
  readonly roiIdRef: MutableRef<number>
}

interface AnnotationWorkflowSetters {
  readonly setAnnotationColors: Dispatch<SetStateAction<Readonly<Record<string, string>>>>
  readonly setHiddenAnnotationIds: Dispatch<SetStateAction<readonly string[]>>
  readonly setHiddenAnnotationSetIds: Dispatch<SetStateAction<readonly string[]>>
  readonly setCellMetadataTracks: Dispatch<
    SetStateAction<readonly ContinuousCellMetadataTrack[]>
  >
  readonly setAnnotationState: Dispatch<
    SetStateAction<AnnotationState<StructuredLoadError>>
  >
  readonly setObservationColorMode: Dispatch<SetStateAction<ObservationColorMode>>
  readonly setSelectedAnnotationGroupId: Dispatch<SetStateAction<string>>
  readonly setSelectedCellMetadataTrackId: Dispatch<SetStateAction<string | null>>
}

interface UseAnnotationWorkflowOptions {
  readonly callbacks: AnnotationWorkflowCallbacks
  readonly data: AnnotationWorkflowData
  readonly loaders: AnnotationWorkflowLoaders
  readonly refs: AnnotationWorkflowRefs
  readonly setters: AnnotationWorkflowSetters
}

// Classes a link hides (hiddenClasses=). Those in the loaded labels stay
// hidden once they load; the rest are dropped.
interface LinkHiddenAnnotationOptions {
  readonly hiddenAnnotationIds?: readonly string[] | undefined
}

interface UseAnnotationWorkflowResult {
  // Imported cells that are not on the map, as "N of M imported cells are
  // not on the map."; null when they all are.
  readonly annotationImportNotice: string | null
  readonly handleAnnotationColorChange: (annotationId: string, color: string) => void
  readonly handleAnnotationGroupChange: (groupId: string) => void
  readonly handleClearAnnotations: () => void
  readonly handleExportAnnotations: () => void
  readonly handleImportAnnotations: (file: File | null) => Promise<void>
  readonly handleImportAnnotationUrl: (
    url: string,
    options?: LinkHiddenAnnotationOptions,
  ) => Promise<boolean>
  readonly handleLoadAnnotations: () => void
  // Loads one of the dataset's annotation sets, such as one named by a link.
  // Loading a set colours cells by it, unless switchColorMode is false (a
  // link's set, under the link's own colour mode).
  readonly loadAnnotationGroup: (
    groupId: string,
    options?: { readonly switchColorMode?: boolean } & LinkHiddenAnnotationOptions,
  ) => void
  readonly handleRemoveCellMetadataTrack: (trackId: string) => void
  readonly handleRemoveAnnotation: (annotationId: string) => void
  readonly handleSaveRoiAnnotation: () => void
}

interface AnnotationImportUrl {
  readonly sourceName: string
  readonly url: string
}

export function useAnnotationWorkflow({
  callbacks,
  data,
  loaders,
  refs,
  setters,
}: UseAnnotationWorkflowOptions): UseAnnotationWorkflowResult {
  const { appendDebugEvent } = callbacks
  const {
    annotationState,
    cellMetadataTracks,
    datasetCellIds,
    datasetUrl,
    loadState,
    roiName,
    roiState,
    selectedAnnotationGroupId,
  } = data
  const { loadAnnotations } = loaders
  const { datasetAbortRef, loadRequestIdRef, roiIdRef } = refs
  const {
    setAnnotationColors,
    setAnnotationState,
    setCellMetadataTracks,
    setHiddenAnnotationIds,
    setHiddenAnnotationSetIds,
    setObservationColorMode,
    setSelectedAnnotationGroupId,
    setSelectedCellMetadataTrackId,
  } = setters
  // The last import's notice, for the dataset it was imported into.
  const [importNotice, setImportNotice] = useState<{
    readonly url: string
    readonly message: string
  } | null>(null)

  const loadAnnotationGroup = useCallback(
    (
      selectedGroupId: string,
      {
        hiddenAnnotationIds = [],
        switchColorMode = true,
      }: { readonly switchColorMode?: boolean } & LinkHiddenAnnotationOptions = {},
    ) => {
      if (loadState.status !== 'ready' || annotationState.status === 'loading') {
        return
      }

      if (selectedGroupId === NO_ANNOTATION_GROUP_ID) {
        return
      }

      const requestId = loadRequestIdRef.current
      const signal = datasetAbortRef.current?.signal
      const groupId =
        selectedGroupId === ALL_ANNOTATION_GROUP_ID ? undefined : selectedGroupId
      appendDebugEvent(
        groupId === undefined ? 'Loading annotations' : `Loading annotations ${groupId}`,
      )
      setAnnotationState(annotationLoadStarted(loadState.url))

      void loadAnnotations(loadState.url, {
        ...(signal === undefined ? {} : { signal }),
        ...(groupId === undefined ? {} : { groupId }),
      })
        .then((annotations) => {
          if (loadRequestIdRef.current !== requestId) {
            return
          }

          setAnnotationState(
            annotationLoadReady(loadState.url, annotations, selectedGroupId),
          )
          setAnnotationColors((current) => colorsForAnnotations(annotations, current))
          setHiddenAnnotationIds(loadedAnnotationIds(annotations, hiddenAnnotationIds))
          // The set replaces the imported labels.
          setImportNotice(null)
          if (switchColorMode && annotations.length > 0) {
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

          setAnnotationState(
            annotationLoadFailed(
              loadState.url,
              createStructuredLoadError('Annotations', error),
            ),
          )
          appendDebugEvent('Annotations failed')
        })
    },
    [
      annotationState,
      appendDebugEvent,
      datasetAbortRef,
      loadAnnotations,
      loadRequestIdRef,
      loadState,
      setAnnotationColors,
      setHiddenAnnotationIds,
      setAnnotationState,
      setObservationColorMode,
    ],
  )
  const handleLoadAnnotations = useCallback(() => {
    loadAnnotationGroup(selectedAnnotationGroupId)
  }, [loadAnnotationGroup, selectedAnnotationGroupId])

  const handleAnnotationGroupChange = useCallback(
    (nextGroupId: string) => {
      setSelectedAnnotationGroupId(nextGroupId)
      appendDebugEvent(`Annotation set: ${shortIdentifier(nextGroupId)}`)
    },
    [appendDebugEvent, setSelectedAnnotationGroupId],
  )

  const importCustomAnnotationText = useCallback(
    (
      text: string,
      sourceName: string,
      sourceLabel: string,
      linkHiddenAnnotationIds: readonly string[] = [],
    ) => {
      const { annotations: importedAnnotations, metadataTracks: importedMetadataTracks } =
        parseCustomAnnotationImport(text, sourceName)
      const cellCheck = checkImportedCellIds(
        importedAnnotations,
        importedMetadataTracks,
        datasetCellIds,
      )

      if (cellCheck.total > 0 && cellCheck.missing === cellCheck.total) {
        throw new ImportedCellsNotFoundError(
          cellCheck.total === 1
            ? 'The imported cell is not on the map.'
            : `None of the ${cellCheck.total.toLocaleString()} imported cells are on the map.`,
        )
      }

      const importedPrefix = customAnnotationFilePrefix(sourceName)
      const importedMetadataPrefix = customCellMetadataFilePrefix(sourceName)
      const nextCellMetadataTracks = mergeImportedCellMetadataTracks(
        cellMetadataTracks,
        importedMetadataTracks,
        importedMetadataPrefix,
      )

      setAnnotationState((current) =>
        annotationLoadReady(
          loadState.status === 'ready' ? loadState.url : datasetUrl,
          mergeImportedAnnotations(
            current.status === 'ready' ? current.annotations : [],
            importedAnnotations,
            importedPrefix,
          ),
          current.status === 'ready' ? current.groupId : undefined,
        ),
      )
      setAnnotationColors((current) =>
        colorsForAnnotations(
          importedAnnotations,
          removeAnnotationColorsByPrefix(current, importedPrefix),
        ),
      )
      setHiddenAnnotationIds((current) => [
        ...removeHiddenAnnotationIdsByPrefix(current, importedPrefix),
        ...loadedAnnotationIds(importedAnnotations, linkHiddenAnnotationIds),
      ])
      setImportNotice(
        cellCheck.missing === 0
          ? null
          : {
              url: loadState.status === 'ready' ? loadState.url : datasetUrl,
              message: `${cellCheck.missing.toLocaleString()} of ${cellCheck.total.toLocaleString()} imported cells are not on the map.`,
            },
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
      datasetCellIds,
      datasetUrl,
      loadState,
      setAnnotationColors,
      setHiddenAnnotationIds,
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
        setImportNotice(null)
        setAnnotationState(
          annotationLoadFailed(
            loadState.status === 'ready' ? loadState.url : datasetUrl,
            annotationImportError(error),
          ),
        )
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
    async (url: string, { hiddenAnnotationIds }: LinkHiddenAnnotationOptions = {}) => {
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

        importCustomAnnotationText(
          text,
          sourceName,
          'Imported URL annotations',
          hiddenAnnotationIds,
        )
        return true
      } catch (error) {
        if (isAbortError(error) || loadRequestIdRef.current !== requestId) {
          return false
        }

        setImportNotice(null)
        setAnnotationState(
          annotationLoadFailed(
            loadState.status === 'ready' ? loadState.url : datasetUrl,
            annotationImportError(error),
          ),
        )
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

        return annotations.length === 0
          ? IDLE_ANNOTATION_STATE
          : { ...current, annotations }
      })
      setAnnotationColors((current) => removeAnnotationColor(current, annotationId))
      setHiddenAnnotationIds((current) =>
        current.filter((hiddenAnnotationId) => hiddenAnnotationId !== annotationId),
      )
      // Only a mode that showed the annotations changes; gene expression,
      // say, stays.
      setObservationColorMode((current) =>
        current !== 'annotations' ||
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
      setHiddenAnnotationIds,
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
    setAnnotationState(IDLE_ANNOTATION_STATE)
    setAnnotationColors({})
    setHiddenAnnotationIds([])
    setHiddenAnnotationSetIds([])
    setImportNotice(null)
    setCellMetadataTracks([])
    setSelectedCellMetadataTrackId(null)
    setObservationColorMode((current) =>
      current === 'annotations' || current === 'metadata' ? 'transcript-count' : current,
    )
    appendDebugEvent('Cleared annotations')
  }, [
    appendDebugEvent,
    setAnnotationColors,
    setHiddenAnnotationIds,
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
    setAnnotationState((current) =>
      annotationLoadReady(
        loadState.url,
        [annotation, ...(current.status === 'ready' ? current.annotations : [])],
        current.status === 'ready' ? current.groupId : undefined,
      ),
    )
    setAnnotationColors((current) => ({
      ...current,
      [annotation.id]: annotationPaletteColor(Object.keys(current).length),
    }))
    setObservationColorMode('annotations')
  }, [
    appendDebugEvent,
    loadState,
    roiIdRef,
    roiName,
    roiState,
    setAnnotationColors,
    setAnnotationState,
    setObservationColorMode,
  ])

  // Shown while the dataset it was imported into is open and labels or
  // tracks are loaded.
  const annotationImportNotice =
    importNotice !== null &&
    loadState.status === 'ready' &&
    importNotice.url === loadState.url &&
    (annotationState.status === 'ready' || cellMetadataTracks.length > 0)
      ? importNotice.message
      : null

  return {
    annotationImportNotice,
    handleAnnotationColorChange,
    handleAnnotationGroupChange,
    handleClearAnnotations,
    handleExportAnnotations,
    handleImportAnnotations,
    handleImportAnnotationUrl,
    handleLoadAnnotations,
    loadAnnotationGroup,
    handleRemoveCellMetadataTrack,
    handleRemoveAnnotation,
    handleSaveRoiAnnotation,
  }
}

// No imported cell is on the map, so the file is most likely for another
// dataset.
class ImportedCellsNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImportedCellsNotFoundError'
  }
}

function annotationImportError(error: unknown): StructuredLoadError {
  if (error instanceof ImportedCellsNotFoundError) {
    return {
      source: 'Annotations',
      code: 'unknown',
      title: 'Imported cells not found',
      message: error.message,
      action: "Check that the file's cell IDs come from this dataset.",
    }
  }

  return createStructuredLoadError('Annotations', error)
}

// The imported cells, counted once each, and how many are not on the map.
// Nothing is missing while the dataset's cells are not read.
function checkImportedCellIds(
  annotations: readonly Annotation[],
  metadataTracks: readonly ContinuousCellMetadataTrack[],
  datasetCellIds: DatasetCellIds,
): { readonly total: number; readonly missing: number } {
  const importedCellIds = new Set<string>()

  for (const annotation of annotations) {
    for (const cellId of annotation.cellIds) {
      importedCellIds.add(cellId)
    }
  }

  for (const track of metadataTracks) {
    for (const { cellId } of track.values ?? []) {
      importedCellIds.add(cellId)
    }
  }

  if (datasetCellIds.size === 0) {
    return { total: importedCellIds.size, missing: 0 }
  }

  let missing = 0

  for (const cellId of importedCellIds) {
    if (!datasetCellIds.has(cellId)) {
      missing += 1
    }
  }

  return { total: importedCellIds.size, missing }
}

// The IDs among the loaded labels, for the classes a link hides.
function loadedAnnotationIds(
  annotations: readonly Annotation[],
  annotationIds: readonly string[],
): readonly string[] {
  if (annotationIds.length === 0) {
    return []
  }

  const loadedIds = new Set(annotations.map((annotation) => annotation.id))

  return annotationIds.filter((annotationId) => loadedIds.has(annotationId))
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
