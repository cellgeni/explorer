import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import {
  customAnnotationImportOnMap,
  customCellMetadataFilePrefix,
  IMPORTED_COLUMN_CLASS_LIMIT,
  skippedColumnsText,
  type ContinuousCellMetadataTrack,
  type CustomAnnotationImport,
} from '../../data/customAnnotations'
import { csvTablesInWorker } from '../../data/csvTablesWorker'
import {
  ALL_ANNOTATION_GROUP_ID,
  NO_ANNOTATION_GROUP_ID,
} from '../../data/datasetAnnotations'
import type { CellId } from '../../data/cellid'
import { normalizeAnnotationColor } from '../../rendering/annotationPalette'
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
import { queryClassId } from '../query/cellQueryModel'
import { defaultRoiName, type RoiState } from '../roi/roiModel'
import {
  IDLE_ANNOTATION_STATE,
  annotationLoadFailed,
  annotationLoadReady,
  annotationLoadStarted,
  annotationIdsHiddenByLink,
  annotationSetIdForAnnotation,
  annotationsToCsv,
  colorsForAnnotations,
  customAnnotationFilePrefix,
  importedFileIdName,
  hasReadyAnnotationsAfterRemove,
  mergeImportedAnnotations,
  nextAnnotationColor,
  removeAnnotationColor,
  removeAnnotationColorsByPrefix,
  removeHiddenAnnotationIdsByPrefix,
  type AnnotationState,
} from './annotationModel'
import { AnnotationUrlTooLargeError, readAnnotationUrlText } from './annotationUrlText'
import type { Annotation } from '../../data/annotation'

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

// Classes and sets a link hides (hiddenClasses=, hiddenSets=). Those in the
// loaded labels stay hidden once they load; the rest are dropped. An import
// colours cells by what it brought, unless switchColorMode is false (a
// link's labels, under the link's own colour mode).
interface LinkHiddenAnnotationOptions {
  readonly hiddenAnnotationIds?: readonly string[] | undefined
  // shownClasses=: the other classes of their sets are hidden.
  readonly shownAnnotationIds?: readonly string[] | undefined
  readonly hiddenAnnotationSetIds?: readonly string[] | undefined
  readonly switchColorMode?: boolean
}

interface UseAnnotationWorkflowResult {
  // Imported cells that are not on the map, as "N of M imported cells are
  // not on the map."; null when they all are.
  readonly annotationImportNotice: string | null
  // Why the last import into the open dataset failed; null after one that
  // worked. A failed import leaves the labels and tracks already loaded.
  readonly annotationImportError: StructuredLoadError | null
  // The URL whose labels or tracks the open dataset shows, imported by URL
  // into it; what a link's annotationUrl= names. Null once they are cleared,
  // replaced by a set or a file of the same name, or another dataset opens.
  readonly linkedAnnotationUrl: string | null
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
  // link's set, under the link's own colour mode). Settles once the labels
  // are shown or the load has failed.
  readonly loadAnnotationGroup: (
    groupId: string,
    options?: { readonly switchColorMode?: boolean } & LinkHiddenAnnotationOptions,
  ) => Promise<void>
  readonly handleRemoveCellMetadataTrack: (trackId: string) => void
  readonly handleRemoveAnnotation: (annotationId: string) => void
  readonly handleSaveRoiAnnotation: () => void
  // Cell Query's Save As Class (plan 23-D7): the cells as one class of the
  // Queries set, first, coloured by annotations as Save ROI does.
  readonly handleSaveQueryAnnotation: (name: string, cellIds: readonly string[]) => void
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
  // The last import's notice, for the dataset it was imported into and the
  // id prefixes its labels and tracks carry.
  const [importNotice, setImportNotice] = useState<{
    readonly url: string
    readonly message: string
    readonly annotationPrefix: string
    readonly metadataPrefix: string
  } | null>(null)
  // The last failed import, for the dataset it was imported into.
  const [importError, setImportError] = useState<{
    readonly url: string
    readonly error: StructuredLoadError
  } | null>(null)
  // The last import by URL: the dataset it went into, the URL, and the id
  // prefixes its labels and tracks carry.
  const [urlImport, setUrlImport] = useState<{
    readonly datasetUrl: string
    readonly url: string
    readonly annotationPrefix: string
    readonly metadataPrefix: string
  } | null>(null)

  // The file names imported into this dataset, by the slug of the name their
  // IDs are made from, so names that slug alike get prefixes of their own.
  const importedFileNamesRef = useRef<{
    readonly url: string
    readonly names: Map<string, string>
  }>({ url: '', names: new Map() })

  const loadAnnotationGroup = useCallback(
    (
      selectedGroupId: string,
      {
        hiddenAnnotationIds = [],
        hiddenAnnotationSetIds = [],
        shownAnnotationIds = [],
        switchColorMode = true,
      }: { readonly switchColorMode?: boolean } & LinkHiddenAnnotationOptions = {},
    ): Promise<void> => {
      if (loadState.status !== 'ready' || annotationState.status === 'loading') {
        return Promise.resolve()
      }

      if (selectedGroupId === NO_ANNOTATION_GROUP_ID) {
        return Promise.resolve()
      }

      const requestId = loadRequestIdRef.current
      const signal = datasetAbortRef.current?.signal
      const groupId =
        selectedGroupId === ALL_ANNOTATION_GROUP_ID ? undefined : selectedGroupId
      appendDebugEvent(
        groupId === undefined ? 'Loading annotations' : `Loading annotations ${groupId}`,
      )
      setAnnotationState(annotationLoadStarted(loadState.url))

      return loadAnnotations(loadState.url, {
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
          setHiddenAnnotationIds(
            annotationIdsHiddenByLink(
              annotations,
              hiddenAnnotationIds,
              shownAnnotationIds,
            ),
          )
          setHiddenAnnotationSetIds((current) =>
            withLoadedAnnotationSetIds(current, annotations, hiddenAnnotationSetIds),
          )
          // The set replaces the imported labels.
          setImportNotice(null)
          setImportError(null)
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
      setHiddenAnnotationSetIds,
      setAnnotationState,
      setObservationColorMode,
    ],
  )
  const handleLoadAnnotations = useCallback(() => {
    void loadAnnotationGroup(selectedAnnotationGroupId)
  }, [loadAnnotationGroup, selectedAnnotationGroupId])

  const handleAnnotationGroupChange = useCallback(
    (nextGroupId: string) => {
      setSelectedAnnotationGroupId(nextGroupId)
      appendDebugEvent(`Annotation set: ${shortIdentifier(nextGroupId)}`)
    },
    [appendDebugEvent, setSelectedAnnotationGroupId],
  )

  const importCustomAnnotationText = useCallback(
    async (
      text: string,
      sourceName: string,
      sourceLabel: string,
      {
        hiddenAnnotationIds: linkHiddenAnnotationIds = [],
        hiddenAnnotationSetIds: linkHiddenAnnotationSetIds = [],
        switchColorMode = true,
        shownAnnotationIds: linkShownAnnotationIds = [],
      }: LinkHiddenAnnotationOptions = {},
    ): Promise<{
      readonly annotationPrefix: string
      readonly metadataPrefix: string
    } | null> => {
      const requestId = loadRequestIdRef.current
      const importUrl = loadState.status === 'ready' ? loadState.url : datasetUrl
      if (importedFileNamesRef.current.url !== importUrl) {
        importedFileNamesRef.current = { url: importUrl, names: new Map() }
      }
      const importedNames = importedFileNamesRef.current.names
      const idName = importedFileIdName(sourceName, importedNames)
      // Held while the file is parsed, so a file of a name that slugs alike,
      // imported meanwhile, is numbered apart from it.
      const reserved = !importedNames.has(slug(idName))
      importedNames.set(slug(idName), sourceName)
      const release = () => {
        if (reserved && importedNames.get(slug(idName)) === sourceName) {
          importedNames.delete(slug(idName))
        }
      }
      let parsed: CustomAnnotationImport

      try {
        // In a worker (O18): a million rows held the main thread for 0.7 s.
        parsed = await csvTablesInWorker.annotationImport(text, sourceName, idName)
      } catch (error) {
        release()
        throw error
      }

      // Another dataset opened while the file was parsed.
      if (loadRequestIdRef.current !== requestId) {
        release()
        return null
      }

      const skippedColumns = parsed.skippedColumns ?? []
      const cellCheck = checkImportedCellIds(
        parsed.annotations,
        parsed.metadataTracks,
        datasetCellIds,
      )

      if (cellCheck.total > 0 && cellCheck.missing === cellCheck.total) {
        release()
        throw new ImportedCellsNotFoundError(
          cellCheck.total === 1
            ? 'The imported cell is not on the map.'
            : `None of the ${cellCheck.total.toLocaleString()} imported cells are on the map.`,
        )
      }

      // Cells of other samples would count in classes, tracks' ranges and
      // exports; the notice says how many were left out.
      const { annotations: importedAnnotations, metadataTracks: importedMetadataTracks } =
        cellCheck.missing === 0
          ? parsed
          : customAnnotationImportOnMap(parsed, datasetCellIds)

      const importedPrefix = customAnnotationFilePrefix(idName)
      const importedMetadataPrefix = customCellMetadataFilePrefix(idName)
      // A file of the URL's name replaces its labels.
      setUrlImport((current) =>
        current?.annotationPrefix === importedPrefix ? null : current,
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
        ...annotationIdsHiddenByLink(
          importedAnnotations,
          linkHiddenAnnotationIds,
          linkShownAnnotationIds,
        ),
      ])
      setHiddenAnnotationSetIds((current) =>
        withLoadedAnnotationSetIds(
          current,
          importedAnnotations,
          linkHiddenAnnotationSetIds,
        ),
      )
      setImportError(null)
      const noticeParts = [
        ...(cellCheck.missing === 0
          ? []
          : [
              `${cellCheck.missing.toLocaleString()} of ${cellCheck.total.toLocaleString()} imported cells are not on the map.`,
            ]),
        ...(skippedColumns.length === 0
          ? []
          : [
              `Left out ${skippedColumnsText(skippedColumns)}: a column of more than ${IMPORTED_COLUMN_CLASS_LIMIT.toLocaleString()} classes names cells rather than grouping them.`,
            ]),
      ]
      setImportNotice(
        noticeParts.length === 0
          ? null
          : {
              url: loadState.status === 'ready' ? loadState.url : datasetUrl,
              annotationPrefix: importedPrefix,
              metadataPrefix: importedMetadataPrefix,
              message: noticeParts.join(' '),
            },
      )
      // From the tracks as they are now: an import read by URL lands after
      // other imports, or a dataset track's values, may have changed them.
      setCellMetadataTracks((current) =>
        mergeImportedCellMetadataTracks(
          current,
          importedMetadataTracks,
          importedMetadataPrefix,
        ),
      )
      // The selected track stays unless this import replaced it; without one
      // the first track is shown.
      setSelectedCellMetadataTrackId((current) => {
        if (
          current !== null &&
          (!current.startsWith(importedMetadataPrefix) ||
            importedMetadataTracks.some((track) => track.id === current))
        ) {
          return current
        }

        return importedMetadataTracks[0]?.id ?? null
      })
      if (switchColorMode && importedAnnotations.length > 0) {
        setObservationColorMode('annotations')
      } else if (switchColorMode && importedMetadataTracks.length > 0) {
        setObservationColorMode('metadata')
      }
      appendDebugEvent(
        importedMetadataTracks.length === 0
          ? `${sourceLabel}: ${importedAnnotations.length.toLocaleString()} labels`
          : `${sourceLabel}: ${importedAnnotations.length.toLocaleString()} labels, ${importedMetadataTracks.length.toLocaleString()} metadata tracks`,
      )
      return { annotationPrefix: importedPrefix, metadataPrefix: importedMetadataPrefix }
    },
    [
      appendDebugEvent,
      datasetCellIds,
      datasetUrl,
      loadRequestIdRef,
      loadState,
      setAnnotationColors,
      setHiddenAnnotationIds,
      setHiddenAnnotationSetIds,
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
        await importCustomAnnotationText(
          await file.text(),
          file.name,
          'Imported annotations',
        )
      } catch (error) {
        setImportNotice(null)
        setImportError({
          url: loadState.status === 'ready' ? loadState.url : datasetUrl,
          error: annotationImportError(error),
        })
        appendDebugEvent('Annotation import failed')
      }
    },
    [appendDebugEvent, datasetUrl, importCustomAnnotationText, loadState],
  )

  const handleImportAnnotationUrl = useCallback(
    async (url: string, linkHidden: LinkHiddenAnnotationOptions = {}) => {
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

        const text = await readAnnotationUrlText(response, sourceName)

        if (loadRequestIdRef.current !== requestId) {
          return false
        }

        const prefixes = await importCustomAnnotationText(
          text,
          sourceName,
          'Imported URL annotations',
          linkHidden,
        )

        if (prefixes === null || loadRequestIdRef.current !== requestId) {
          return false
        }

        if (loadState.status === 'ready') {
          setUrlImport({ datasetUrl: loadState.url, url: url.trim(), ...prefixes })
        }
        return true
      } catch (error) {
        if (isAbortError(error) || loadRequestIdRef.current !== requestId) {
          return false
        }

        setImportNotice(null)
        setImportError({
          url: loadState.status === 'ready' ? loadState.url : datasetUrl,
          error: annotationImportError(error),
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
    setImportError(null)
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
      // A selection read up to the cell limit holds only its first cells.
      label: roiState.hitCellLimit
        ? `${name} (first ${roiState.cells.length.toLocaleString()} cells)`
        : name,
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
      [annotation.id]: nextAnnotationColor(current),
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

  const handleSaveQueryAnnotation = useCallback(
    (name: string, cellIds: readonly string[]) => {
      if (loadState.status !== 'ready') return

      const current =
        annotationState.status === 'ready' ? annotationState.annotations : []
      const annotation: Annotation = {
        id: queryClassId(current, name).id,
        label: name,
        // The overview's own cell IDs, so already the dataset's.
        cellIds: cellIds as readonly CellId[],
      }

      appendDebugEvent(`Saved query class ${name}`)
      setAnnotationState((state) =>
        annotationLoadReady(
          loadState.url,
          [annotation, ...(state.status === 'ready' ? state.annotations : [])],
          state.status === 'ready' ? state.groupId : undefined,
        ),
      )
      setAnnotationColors((colors) => ({
        ...colors,
        [annotation.id]: nextAnnotationColor(colors),
      }))
      setObservationColorMode('annotations')
    },
    [
      annotationState,
      appendDebugEvent,
      loadState,
      setAnnotationColors,
      setAnnotationState,
      setObservationColorMode,
    ],
  )

  // Shown while the dataset it was imported into is open and the labels or
  // tracks it brought are loaded, not other labels loaded after a reopen.
  const annotationImportNotice =
    importNotice !== null &&
    loadState.status === 'ready' &&
    importNotice.url === loadState.url &&
    ((annotationState.status === 'ready' &&
      annotationState.annotations.some((annotation) =>
        annotation.id.startsWith(importNotice.annotationPrefix),
      )) ||
      cellMetadataTracks.some((track) =>
        track.id.startsWith(importNotice.metadataPrefix),
      ))
      ? importNotice.message
      : null

  const openDatasetImportError =
    importError !== null &&
    importError.url === (loadState.status === 'ready' ? loadState.url : datasetUrl)
      ? importError.error
      : null

  const linkedAnnotationUrl =
    urlImport !== null &&
    loadState.status === 'ready' &&
    urlImport.datasetUrl === loadState.url &&
    ((annotationState.status === 'ready' &&
      annotationState.annotations.some((annotation) =>
        annotation.id.startsWith(urlImport.annotationPrefix),
      )) ||
      cellMetadataTracks.some((track) => track.id.startsWith(urlImport.metadataPrefix)))
      ? urlImport.url
      : null

  return {
    annotationImportError: openDatasetImportError,
    annotationImportNotice,
    linkedAnnotationUrl,
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
    handleSaveQueryAnnotation,
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

  if (error instanceof AnnotationUrlTooLargeError) {
    return {
      source: 'Annotations',
      code: 'size-limit',
      title: 'Annotation file too large',
      message: error.message,
      action:
        'The file was not read. Use a file of 100 MiB or smaller, such as one with fewer columns, or split the labels into several files.',
    }
  }

  // By name: a file parsed in the worker fails with a plain Error of this name.
  if (error instanceof Error && error.name === 'AnnotationFileFormatError') {
    return {
      source: 'Annotations',
      code: 'unsupported',
      title: 'Annotation file not read',
      message: error.message,
      action:
        'Check the file: CSV or TSV with a cell_id column and a label column or columns of classes, or JSON rows or {label: [cell IDs]}.',
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

// The hidden sets with those a link hides that the loaded labels belong to.
function withLoadedAnnotationSetIds(
  hiddenSetIds: readonly string[],
  annotations: readonly Annotation[],
  linkHiddenSetIds: readonly string[],
): readonly string[] {
  if (linkHiddenSetIds.length === 0) {
    return hiddenSetIds
  }

  const loadedSetIds = new Set(annotations.map(annotationSetIdForAnnotation))
  const added = linkHiddenSetIds.filter(
    (setId) => loadedSetIds.has(setId) && !hiddenSetIds.includes(setId),
  )

  return added.length === 0 ? hiddenSetIds : [...hiddenSetIds, ...added]
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

  // The segments of `url.pathname` are already percent-encoded.
  return new URL(
    `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${pathParts.join('/')}`,
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
