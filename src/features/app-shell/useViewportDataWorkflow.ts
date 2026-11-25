import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import type { ViewerViewportDetail } from '../../components/ViewerCore'
import {
  geneExpressionReadCovers,
  geneExpressionRequestKey,
  geneExpressionWaitingKey,
  planGeneExpressionLod,
  type GeneExpressionDetailMode,
  type GeneExpressionReadArea,
} from '../../data/geneExpressionLod'
import { formatGeneExpressionStageTiming } from '../../data/geneExpressionTiming'
import {
  shareableViewStateKey,
  viewStateToShareable,
  type ShareableViewState,
} from '../../data/shareableState'
import {
  formatRuntimeMemorySnapshot,
  readRuntimeMemorySnapshot,
} from '../../data/runtimeMemory'
import { telemetryEvent, type TelemetryEvent } from '../../data/telemetry'
import type { BBox } from '../../data/coords'
import type { GeneExpressionBatch, SpatialElement } from '../../datasets/spatialDataset'
import type { VisiumHdBinSizeMicrometers } from '../../datasets/visiumHdDataset'
import {
  boundaryRequestCovers,
  boundaryViewportKey,
  normalizeBoundaryCellLimit,
  paddedBoundaryBbox,
  shouldLoadBoundaryPolygons,
  type BoundaryRequestArea,
} from '../../rendering/boundaryViewport'
import type { GeneExpressionScoreMode } from '../../rendering/deckLayers'
import type { BoundaryElementsLoader, GeneExpressionLoader } from './appDependencies'
import {
  formatElapsed,
  invalidateLatestRequest,
  isAbortError,
  readTimestamp,
  startLatestRequest,
  type DebugLogAppendOptions,
  type LatestRequestRefs,
} from './appRuntimeModel'
import {
  IDLE_BOUNDARY_LOAD_STATE,
  boundaryLoadFailed,
  boundaryLoadOverLimit,
  boundaryLoadReady,
  boundaryLoadStarted,
  type BoundaryLoadState,
  type DatasetLoadState,
} from '../dataset/datasetLoadModel'
import {
  createStructuredLoadError,
  readErrorMessage,
  type StructuredLoadError,
} from '../errors/loadErrorModel'
import {
  IDLE_GENE_EXPRESSION_STATE,
  formatGeneExpressionTiming,
  geneExpressionLoadFailed,
  geneExpressionLoadReady,
  geneExpressionLoadStarted,
  geneExpressionModeLabel,
  geneExpressionWaiting,
  type GeneExpressionState,
} from '../genes/geneControlsModel'

type Setter<T> = Dispatch<SetStateAction<T>>

interface MutableRef<T> {
  current: T
}

interface BoundaryRequestRefs extends LatestRequestRefs {
  readonly boundaryViewportKeyRef: MutableRef<string | null>
}

interface GeneExpressionRequestRefs extends LatestRequestRefs {
  readonly geneExpressionViewportKeyRef: MutableRef<string | null>
}

interface ViewportDataWorkflowRequests {
  readonly boundary: BoundaryRequestRefs
  readonly nucleusBoundary?: BoundaryRequestRefs
  readonly geneExpression: GeneExpressionRequestRefs
  readonly lastViewportDetailRef: MutableRef<ViewerViewportDetail | null>
}

interface ViewportDataWorkflowLoaders {
  readonly boundaryElements: BoundaryElementsLoader
  // Nuclei load only while this is set (their checkbox is on).
  readonly nucleusBoundaryElements?: BoundaryElementsLoader
  readonly geneExpression: GeneExpressionLoader
}

interface ViewportDataWorkflowSetters {
  readonly setBoundaryElements: Setter<readonly SpatialElement[]>
  readonly setNucleusBoundaryElements?: Setter<readonly SpatialElement[]>
  readonly setBoundaryState: Setter<BoundaryLoadState<StructuredLoadError>>
  readonly setNucleusBoundaryState?: Setter<BoundaryLoadState<StructuredLoadError>>
  readonly setCurrentViewportDetail: Setter<ViewerViewportDetail | null>
  readonly setGeneExpressionBatch: Setter<GeneExpressionBatch | null>
  readonly setGeneExpressionState: Setter<GeneExpressionState<StructuredLoadError>>
  readonly setShareableViewState: Setter<ShareableViewState | undefined>
}

interface ViewportDataWorkflowCallbacks {
  readonly appendDebugEvent: (message: string, options?: DebugLogAppendOptions) => void
  readonly recordTelemetry: (event: TelemetryEvent) => void
  readonly rememberGeneExpressionScaleMax: (
    key: string,
    batch: GeneExpressionBatch,
    scoreMode: GeneExpressionScoreMode,
  ) => void
}

interface ViewportDataWorkflowControls {
  readonly boundaryCellLimit: number
  // Whether cell outlines load; nuclei load while their loader is set.
  readonly cellBoundaryLoadingEnabled?: boolean
  readonly geneExpressionDetailMode: GeneExpressionDetailMode
  readonly geneExpressionDisabledMessage?: string | undefined
  readonly geneExpressionLoadingEnabled?: boolean
  readonly geneExpressionScaleKey: string
  readonly geneExpressionScoreMode: GeneExpressionScoreMode
  readonly visiumHdBinSizeMicrometers?: VisiumHdBinSizeMicrometers
  // Counts the outlines in a box when the viewer has no cells to count (an
  // image's imported segmentation); replaces the viewer's count for
  // boundary requests.
  readonly viewportCellCount?: ((bbox: BBox) => number) | undefined
}

interface ViewportDataWorkflowData {
  readonly loadState: DatasetLoadState<StructuredLoadError>
  readonly overviewExtent: BBox | null
  readonly selectedGenes: readonly string[]
}

interface UseViewportDataWorkflowOptions {
  readonly callbacks: ViewportDataWorkflowCallbacks
  readonly controls: ViewportDataWorkflowControls
  readonly data: ViewportDataWorkflowData
  readonly loaders: ViewportDataWorkflowLoaders
  readonly requests: ViewportDataWorkflowRequests
  readonly setters: ViewportDataWorkflowSetters
}

interface UseViewportDataWorkflowResult {
  readonly handleViewportChange: (detail: ViewerViewportDetail) => void
}

export function useViewportDataWorkflow({
  callbacks: { appendDebugEvent, recordTelemetry, rememberGeneExpressionScaleMax },
  controls: {
    boundaryCellLimit,
    cellBoundaryLoadingEnabled = true,
    geneExpressionDetailMode,
    geneExpressionDisabledMessage,
    geneExpressionLoadingEnabled = true,
    geneExpressionScaleKey,
    geneExpressionScoreMode,
    visiumHdBinSizeMicrometers,
    viewportCellCount,
  },
  data: { loadState, overviewExtent, selectedGenes },
  loaders,
  requests,
  setters,
}: UseViewportDataWorkflowOptions): UseViewportDataWorkflowResult {
  const {
    boundary: {
      abortRef: boundaryAbortRef,
      requestIdRef: boundaryRequestIdRef,
      boundaryViewportKeyRef,
    },
    geneExpression: {
      abortRef: geneExpressionAbortRef,
      requestIdRef: geneExpressionRequestIdRef,
      geneExpressionViewportKeyRef,
    },
    lastViewportDetailRef,
  } = requests
  const nucleusBoundaryAbortRef = requests.nucleusBoundary?.abortRef
  const nucleusBoundaryRequestIdRef = requests.nucleusBoundary?.requestIdRef
  const nucleusBoundaryViewportKeyRef = requests.nucleusBoundary?.boundaryViewportKeyRef
  const {
    boundaryElements: loadBoundaryElements,
    geneExpression: loadGeneExpression,
    nucleusBoundaryElements: loadNucleusBoundaryElements,
  } = loaders
  const {
    setBoundaryElements,
    setBoundaryState,
    setCurrentViewportDetail,
    setGeneExpressionBatch,
    setGeneExpressionState,
    setNucleusBoundaryElements,
    setNucleusBoundaryState,
    setShareableViewState,
  } = setters
  // The expression read that failed, with the view it was made for.
  const failedGeneExpressionReadRef = useRef<{
    readonly key: string
    readonly detail: ViewerViewportDetail
  } | null>(null)
  // Area of each layer's boundary request identified by its viewport key ref;
  // it is only trusted while that key is still current.
  const cellBoundaryAreaRef = useRef<BoundaryRequestAreaWithKey | null>(null)
  const nucleusBoundaryAreaRef = useRef<BoundaryRequestAreaWithKey | null>(null)
  // Box of the last expression read, trusted only while its key is the
  // current one (clearing the key asks for a new read).
  const geneExpressionReadRef = useRef<GeneExpressionReadArea | null>(null)
  const handleViewportChange = useCallback(
    (detail: ViewerViewportDetail) => {
      if (loadState.status !== 'ready') {
        return
      }

      lastViewportDetailRef.current = detail
      // The viewer reports its view again when a handler changes; the same
      // view keeps its detail, so nothing that reads it is worked out again.
      setCurrentViewportDetail((current) =>
        current !== null && sameViewportDetail(current, detail) ? current : detail,
      )
      const nextShareableViewState = viewStateToShareable(detail.viewState)
      setShareableViewState((current) =>
        shareableViewStateKey(current) === shareableViewStateKey(nextShareableViewState)
          ? current
          : nextShareableViewState,
      )

      // Cell and nucleus outlines are separate requests, so each draws when
      // it arrives, a failure clears only its own outlines, and a checkbox
      // requests only its own outline type.
      const boundaryLayers: BoundaryLayer[] = [
        {
          kind: 'cell',
          enabled: cellBoundaryLoadingEnabled,
          load: loadBoundaryElements,
          requests: {
            abortRef: boundaryAbortRef,
            requestIdRef: boundaryRequestIdRef,
            boundaryViewportKeyRef,
          },
          areaRef: cellBoundaryAreaRef,
          setElements: setBoundaryElements,
          setState: setBoundaryState,
        },
      ]

      if (
        nucleusBoundaryAbortRef !== undefined &&
        nucleusBoundaryRequestIdRef !== undefined &&
        nucleusBoundaryViewportKeyRef !== undefined &&
        setNucleusBoundaryElements !== undefined &&
        setNucleusBoundaryState !== undefined
      ) {
        boundaryLayers.push({
          kind: 'nucleus',
          enabled: loadNucleusBoundaryElements !== undefined,
          load: loadNucleusBoundaryElements ?? loadNoBoundaryElements,
          requests: {
            abortRef: nucleusBoundaryAbortRef,
            requestIdRef: nucleusBoundaryRequestIdRef,
            boundaryViewportKeyRef: nucleusBoundaryViewportKeyRef,
          },
          areaRef: nucleusBoundaryAreaRef,
          setElements: setNucleusBoundaryElements,
          setState: setNucleusBoundaryState,
        })
      }

      const boundaryLoadingEnabled = boundaryLayers.some((layer) => layer.enabled)
      const boundaryDetail =
        viewportCellCount === undefined || !boundaryLoadingEnabled
          ? detail
          : { ...detail, visibleCellCount: viewportCellCount(detail.bbox) }

      if (!shouldLoadBoundaryPolygons(boundaryDetail, { cellLimit: boundaryCellLimit })) {
        if (boundaryLoadingEnabled && boundaryDetail.visibleCellCount > 0) {
          appendDebugEvent(
            `Boundaries deferred: ${boundaryDetail.visibleCellCount.toLocaleString()} visible cells exceed the ${boundaryCellLimit.toLocaleString()} boundary limit. Zoom in or raise Boundary limit to load true polygons.`,
            { coalesceKey: 'boundary-query' },
          )
        }

        for (const layer of boundaryLayers) {
          clearBoundaryLayer(layer)
        }
      } else {
        for (const layer of boundaryLayers) {
          if (layer.enabled) {
            requestBoundaryLayer(layer, boundaryDetail, {
              appendDebugEvent,
              baseUrl: loadState.url,
              boundaryCellLimit,
              recordTelemetry,
            })
          } else {
            pauseBoundaryLayer(layer)
          }
        }
      }

      if (!geneExpressionLoadingEnabled || selectedGenes.length === 0) {
        invalidateLatestRequest({
          abortRef: geneExpressionAbortRef,
          requestIdRef: geneExpressionRequestIdRef,
        })
        geneExpressionViewportKeyRef.current = null
        setGeneExpressionBatch(null)
        setGeneExpressionState((current) => {
          if (selectedGenes.length > 0 && geneExpressionDisabledMessage !== undefined) {
            return current.status === 'waiting' &&
              current.message === geneExpressionDisabledMessage
              ? current
              : geneExpressionWaiting(geneExpressionDisabledMessage)
          }

          return current.status === 'idle' ? current : IDLE_GENE_EXPRESSION_STATE
        })
        return
      }

      // A failed read is tried again for another view, not for the same view
      // replayed when an input changes.
      const failedRead = failedGeneExpressionReadRef.current

      if (
        failedRead !== null &&
        failedRead.key === geneExpressionViewportKeyRef.current &&
        failedRead.detail !== detail
      ) {
        failedGeneExpressionReadRef.current = null
        geneExpressionViewportKeyRef.current = null
      }

      const expressionPlan = planGeneExpressionLod(detail, {
        detailMode: geneExpressionDetailMode,
        slideBbox: overviewExtent,
        totalCellCount: loadState.cellCount,
        ...(visiumHdBinSizeMicrometers === undefined
          ? {}
          : { visiumHdBinSizeMicrometers }),
      })

      if (expressionPlan.kind === 'waiting') {
        const waitingKey = geneExpressionWaitingKey(
          loadState.url,
          detail,
          selectedGenes,
          geneExpressionDetailMode,
        )

        if (waitingKey === geneExpressionViewportKeyRef.current) {
          return
        }

        invalidateLatestRequest({
          abortRef: geneExpressionAbortRef,
          requestIdRef: geneExpressionRequestIdRef,
        })
        geneExpressionViewportKeyRef.current = waitingKey
        setGeneExpressionBatch(null)
        setGeneExpressionState(geneExpressionWaiting(expressionPlan.message))
        return
      }

      const expressionKey = geneExpressionRequestKey(
        loadState.url,
        detail,
        expressionPlan,
        selectedGenes,
      )

      if (
        expressionKey === geneExpressionViewportKeyRef.current &&
        geneExpressionReadCovers(
          geneExpressionReadRef.current,
          expressionKey,
          expressionPlan,
          detail.bbox,
        )
      ) {
        return
      }

      const expressionRequest = startLatestRequest({
        abortRef: geneExpressionAbortRef,
        requestIdRef: geneExpressionRequestIdRef,
      })
      const expressionStartedAt = readTimestamp()
      geneExpressionViewportKeyRef.current = expressionKey
      geneExpressionReadRef.current = { key: expressionKey, bbox: expressionPlan.bbox }
      setGeneExpressionState(
        geneExpressionLoadStarted(
          loadState.url,
          selectedGenes,
          expressionPlan.mode,
          expressionPlan.sourceCellCount,
        ),
      )
      appendDebugEvent(
        `${geneExpressionModeLabel(expressionPlan.mode)} started: ${selectedGenes.join(', ')}; ${expressionPlan.sourceCellCount.toLocaleString()} source cells, limit ${expressionPlan.cellLimit.toLocaleString()}, stride ${expressionPlan.sampleStride.toLocaleString()}`,
        { coalesceKey: 'gene-expression-query' },
      )

      const expressionOptions: Parameters<GeneExpressionLoader>[3] = {
        signal: expressionRequest.signal,
        limit: expressionPlan.cellLimit,
        sampleStride: expressionPlan.sampleStride,
        ...(expressionPlan.visiumHdBinSizeMicrometers === undefined
          ? {}
          : { visiumHdBinSizeMicrometers: expressionPlan.visiumHdBinSizeMicrometers }),
        onStageTiming: (timing) => {
          if (expressionRequest.signal.aborted || !expressionRequest.isCurrent()) {
            return
          }

          appendDebugEvent(
            `Expression stage: ${formatGeneExpressionStageTiming(timing)}`,
            { coalesceKey: `gene-expression-stage-${timing.stage}` },
          )
        },
      }
      const loadExpressionBatch = async (): Promise<GeneExpressionBatch> => {
        try {
          return await loadGeneExpression(
            loadState.url,
            expressionPlan.bbox,
            selectedGenes,
            expressionOptions,
          )
        } catch (error) {
          if (
            expressionRequest.signal.aborted ||
            !isRetryableExpressionLoadError(error)
          ) {
            throw error
          }

          appendDebugEvent('Gene expression load failed; retrying', {
            coalesceKey: 'gene-expression-query',
          })

          return loadGeneExpression(
            loadState.url,
            expressionPlan.bbox,
            selectedGenes,
            expressionOptions,
          )
        }
      }

      void loadExpressionBatch()
        .then((batch) => {
          if (!expressionRequest.isCurrent()) {
            return
          }

          const timingDetail = formatGeneExpressionTiming(batch.timing)
          const memoryDetail = currentMemoryDetail()
          // Some readers also return cells with zero expression.
          const positiveCellCount = batch.elements.filter(
            (element) => element.count > 0,
          ).length

          rememberGeneExpressionScaleMax(
            geneExpressionScaleKey,
            batch,
            geneExpressionScoreMode,
          )
          setGeneExpressionBatch({ ...batch, bbox: expressionPlan.bbox })
          setGeneExpressionState(
            geneExpressionLoadReady(
              loadState.url,
              batch.genes,
              expressionPlan.mode,
              positiveCellCount,
              expressionPlan.sourceCellCount,
            ),
          )
          recordTelemetry(
            telemetryEvent('gene-expression.load', 'success', {
              startedAt: expressionStartedAt,
              detail: [
                `${geneExpressionModeLabel(expressionPlan.mode)}: ${positiveCellCount.toLocaleString()} positive cells across ${expressionPlan.sourceCellCount.toLocaleString()} source cells (${timingDetail})`,
                memoryDetail === undefined ? undefined : `memory ${memoryDetail}`,
              ]
                .filter((part): part is string => part !== undefined)
                .join('; '),
            }),
          )
          appendDebugEvent(
            `${geneExpressionModeLabel(expressionPlan.mode)} ready: ${positiveCellCount.toLocaleString()} positive cells in ${formatElapsed(
              expressionStartedAt,
            )} (${formatProfileTimingDetail(timingDetail, memoryDetail)})`,
            { coalesceKey: 'gene-expression-query' },
          )
        })
        .catch((error) => {
          if (isAbortError(error)) {
            return
          }

          if (!expressionRequest.isCurrent()) {
            return
          }

          // The next view the viewer reports reads again, also under a key
          // that does not depend on the view (the whole slide).
          failedGeneExpressionReadRef.current = { key: expressionKey, detail }
          setGeneExpressionBatch(null)
          setGeneExpressionState(
            geneExpressionLoadFailed(
              loadState.url,
              createStructuredLoadError('Gene expression', error),
            ),
          )
          recordTelemetry(
            telemetryEvent('gene-expression.load', 'failure', {
              startedAt: expressionStartedAt,
              detail: readErrorMessage(error),
            }),
          )
          appendDebugEvent('Gene expression load failed', {
            coalesceKey: 'gene-expression-query',
          })
        })
        .finally(() => {
          expressionRequest.complete()
        })
    },
    [
      appendDebugEvent,
      boundaryAbortRef,
      boundaryCellLimit,
      boundaryRequestIdRef,
      boundaryViewportKeyRef,
      cellBoundaryLoadingEnabled,
      geneExpressionAbortRef,
      geneExpressionDetailMode,
      geneExpressionDisabledMessage,
      geneExpressionLoadingEnabled,
      geneExpressionScaleKey,
      geneExpressionScoreMode,
      visiumHdBinSizeMicrometers,
      geneExpressionRequestIdRef,
      geneExpressionViewportKeyRef,
      lastViewportDetailRef,
      loadBoundaryElements,
      loadNucleusBoundaryElements,
      loadGeneExpression,
      loadState,
      nucleusBoundaryAbortRef,
      nucleusBoundaryRequestIdRef,
      nucleusBoundaryViewportKeyRef,
      overviewExtent,
      recordTelemetry,
      rememberGeneExpressionScaleMax,
      selectedGenes,
      setBoundaryElements,
      setNucleusBoundaryElements,
      setNucleusBoundaryState,
      setBoundaryState,
      setCurrentViewportDetail,
      setGeneExpressionBatch,
      setGeneExpressionState,
      setShareableViewState,
      viewportCellCount,
    ],
  )

  useEffect(() => {
    const detail = lastViewportDetailRef.current

    if (detail !== null) {
      handleViewportChange(detail)
    }
  }, [handleViewportChange, lastViewportDetailRef])

  return { handleViewportChange }
}

function isRetryableExpressionLoadError(error: unknown): boolean {
  if (isAbortError(error)) {
    return false
  }

  const message = readErrorMessage(error).toLowerCase()

  return (
    isTypeErrorLike(error) ||
    message.includes('failed to fetch') ||
    message.includes('load failed') ||
    message.includes('network request failed') ||
    message.includes('networkerror')
  )
}

function isTypeErrorLike(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'name' in error &&
    error.name === 'TypeError'
  )
}

type BoundaryLayerKind = 'cell' | 'nucleus'

type BoundaryRequestAreaWithKey = BoundaryRequestArea & {
  readonly key: string
  readonly failed?: boolean
}

interface BoundaryLayer {
  readonly kind: BoundaryLayerKind
  readonly enabled: boolean
  readonly load: BoundaryElementsLoader
  readonly requests: BoundaryRequestRefs
  readonly areaRef: MutableRef<BoundaryRequestAreaWithKey | null>
  readonly setElements: Setter<readonly SpatialElement[]>
  readonly setState: Setter<BoundaryLoadState<StructuredLoadError>>
}

interface BoundaryLayerContext {
  readonly appendDebugEvent: ViewportDataWorkflowCallbacks['appendDebugEvent']
  readonly baseUrl: string
  readonly boundaryCellLimit: number
  readonly recordTelemetry: ViewportDataWorkflowCallbacks['recordTelemetry']
}

const BOUNDARY_LAYER_COPY: Record<
  BoundaryLayerKind,
  {
    readonly label: 'Cell boundaries' | 'Nucleus boundaries'
    readonly failed: string
    readonly plural: string
    readonly telemetryName: string
    readonly coalesceKey: string
  }
> = {
  cell: {
    label: 'Cell boundaries',
    failed: 'Cell boundary load failed',
    plural: 'cells',
    telemetryName: 'viewport.boundaries.load',
    coalesceKey: 'boundary-query',
  },
  nucleus: {
    label: 'Nucleus boundaries',
    failed: 'Nucleus boundary load failed',
    plural: 'nuclei',
    telemetryName: 'viewport.nucleus-boundaries.load',
    coalesceKey: 'nucleus-boundary-query',
  },
}

const loadNoBoundaryElements: BoundaryElementsLoader = async () => ({ elements: [] })

// Outside the boundary limit no layer keeps outlines.
function clearBoundaryLayer(layer: BoundaryLayer): void {
  invalidateLatestRequest(layer.requests)
  layer.requests.boundaryViewportKeyRef.current = null
  layer.setElements((current) => (current.length === 0 ? current : []))
  layer.setState((current) =>
    current.status === 'idle' ? current : IDLE_BOUNDARY_LOAD_STATE,
  )
}

// A hidden layer stops its request and drops its error, but keeps outlines it
// already read, so showing it again in the same area reads nothing.
function pauseBoundaryLayer(layer: BoundaryLayer): void {
  const inFlight = layer.requests.abortRef.current !== null

  if (!inFlight && layer.areaRef.current?.failed !== true) {
    return
  }

  if (inFlight) {
    invalidateLatestRequest(layer.requests)
  }

  layer.requests.boundaryViewportKeyRef.current = null
  layer.areaRef.current = null
  layer.setState(IDLE_BOUNDARY_LOAD_STATE)
}

function requestBoundaryLayer(
  layer: BoundaryLayer,
  detail: ViewerViewportDetail,
  context: BoundaryLayerContext,
  { padded = true }: { readonly padded?: boolean } = {},
): void {
  const { appendDebugEvent, baseUrl, boundaryCellLimit, recordTelemetry } = context
  const { boundaryViewportKeyRef } = layer.requests
  const copy = BOUNDARY_LAYER_COPY[layer.kind]
  const lastArea = layer.areaRef.current
  const currentArea =
    lastArea !== null &&
    lastArea.key === boundaryViewportKeyRef.current &&
    lastArea.key === boundaryViewportKey(baseUrl, lastArea.bbox)
      ? lastArea
      : null

  if (boundaryRequestCovers(currentArea, detail)) {
    return
  }

  const requestBbox = padded
    ? paddedBoundaryBbox(detail, { cellLimit: boundaryCellLimit })
    : detail.bbox
  const requestKey = boundaryViewportKey(baseUrl, requestBbox)
  const requestArea: BoundaryRequestAreaWithKey = {
    key: requestKey,
    bbox: requestBbox,
    zoom: detail.viewState.zoom,
  }
  layer.areaRef.current = requestArea
  const request = startLatestRequest(layer.requests)
  boundaryViewportKeyRef.current = requestKey
  layer.setState(boundaryLoadStarted(baseUrl))
  const startedAt = readTimestamp()
  appendDebugEvent(
    `${copy.label} started: ${detail.visibleCellCount.toLocaleString()} visible cells`,
    { coalesceKey: copy.coalesceKey },
  )

  void layer
    .load(baseUrl, requestBbox, { signal: request.signal, cellLimit: boundaryCellLimit })
    .then((batch) => {
      if (!request.isCurrent()) {
        return
      }

      const durationMs = Math.max(0, readTimestamp() - startedAt)
      const profileDetail = formatBoundaryProfileDetail(
        batch.elements.length,
        copy.plural,
        durationMs,
      )

      if (batch.overLimit !== undefined) {
        // Nothing was drawn here, so any zoom or pan asks again.
        layer.areaRef.current = null
        boundaryViewportKeyRef.current = null

        // The margin held more outlines than the limit, but the view holds
        // fewer: read the view alone.
        if (
          requestBbox !== detail.bbox &&
          detail.visibleCellCount < normalizeBoundaryCellLimit(boundaryCellLimit)
        ) {
          requestBoundaryLayer(layer, detail, context, { padded: false })
          return
        }
      }

      layer.setElements(batch.elements)
      layer.setState(
        batch.overLimit === undefined
          ? boundaryLoadReady(baseUrl, batch.elements.length)
          : boundaryLoadOverLimit(baseUrl, batch.overLimit.count),
      )
      recordTelemetry(
        telemetryEvent(copy.telemetryName, 'success', {
          startedAt,
          detail: profileDetail,
        }),
      )
      appendDebugEvent(`${copy.label} ready: ${profileDetail}`, {
        coalesceKey: copy.coalesceKey,
      })
    })
    .catch((error: unknown) => {
      if (isAbortError(error) || !request.isCurrent()) {
        return
      }

      // The failed area is not read again until the view leaves it or the
      // layer is hidden and shown again.
      layer.areaRef.current = { ...requestArea, failed: true }
      layer.setElements([])
      layer.setState(
        boundaryLoadFailed(baseUrl, createStructuredLoadError(copy.label, error)),
      )
      recordTelemetry(
        telemetryEvent(copy.telemetryName, 'failure', {
          startedAt,
          detail: readErrorMessage(error),
        }),
      )
      appendDebugEvent(copy.failed, { coalesceKey: copy.coalesceKey })
    })
    .finally(() => {
      request.complete()
    })
}

function formatBoundaryProfileDetail(
  count: number,
  plural: string,
  durationMs: number,
): string {
  const memoryDetail = currentMemoryDetail()
  const timing = `${count.toLocaleString()} ${plural} in ${formatDurationMs(durationMs)}`

  return memoryDetail === undefined ? timing : `${timing}, memory ${memoryDetail}`
}

function currentMemoryDetail(): string | undefined {
  return formatRuntimeMemorySnapshot(readRuntimeMemorySnapshot())
}

function formatProfileTimingDetail(
  timingDetail: string,
  memoryDetail: string | undefined,
): string {
  return memoryDetail === undefined
    ? timingDetail
    : `${timingDetail}; memory ${memoryDetail}`
}

function formatDurationMs(durationMs: number): string {
  return `${Math.round(durationMs).toLocaleString()} ms`
}

export function sameViewportDetail(
  left: ViewerViewportDetail,
  right: ViewerViewportDetail,
): boolean {
  return (
    left.visibleCellCount === right.visibleCellCount &&
    left.bbox.minX === right.bbox.minX &&
    left.bbox.maxX === right.bbox.maxX &&
    left.bbox.minY === right.bbox.minY &&
    left.bbox.maxY === right.bbox.maxY &&
    left.viewState.zoom === right.viewState.zoom &&
    left.viewState.minZoom === right.viewState.minZoom &&
    left.viewState.maxZoom === right.viewState.maxZoom &&
    left.viewState.target.every((value, index) => value === right.viewState.target[index])
  )
}
