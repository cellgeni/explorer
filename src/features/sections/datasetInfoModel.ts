import type { Dispatch, FormEventHandler, SetStateAction } from 'react'
import { scaffoldDeckLayerCount } from '../../components/viewerCoreModel'
import type { PerformanceBudget } from '../../data/performanceBudget'
import type { AnnDataVisiumView } from '../../datasets/h5adDataset'
import type { SpatialDataSelection } from '../../datasets/spatialDataDataset'
import type { VisiumImageKind } from '../../datasets/visiumFormat'
import type { VisiumHdBinSizeMicrometers } from '../../datasets/visiumHdDataset'
import {
  MAX_BOUNDARY_VIEWPORT_CELL_LIMIT,
  normalizeBoundaryCellLimit,
} from '../../rendering/boundaryViewport'
import { bundledDeckVersion } from '../../rendering/deckLayers'
import type {
  AppendDebugEvent,
  DebugLogEntry,
  FallbackNoticeEntry,
} from '../app-shell/appRuntimeModel'
import type {
  CellFeatureMatrixCapabilityState,
  DatasetDiagnosticsState,
} from '../dataset/datasetLoadModel'
import type { DatasetManifestAbout } from '../dataset/datasetManifestModel'
import type { SpatialDataControlState } from '../dataset/spatialDataModel'
import type { VisiumHdControlState } from '../dataset/visiumHdModel'
import type { VisiumControlState } from '../dataset/visiumModel'
import type { StructuredLoadError } from '../errors/loadErrorModel'
import { PLATFORM_NAMES, type AppPlatformKind } from '../app-shell/platformAdapter'

// The dataset itself: opening one, sharing it, what it is, its view options
// and diagnostics (UNIFIED_PLAN.md, 15.2-A): the info drawer, the dataset
// menu, Share and Settings.
export interface DatasetInfoModel {
  // What is open, for the info drawer's Dataset section (15.2-F). Empty
  // before a dataset is ready.
  readonly facts: readonly DatasetFact[]
  readonly open: OpenDatasetModel
  readonly share: ShareLinkModel
  readonly about: DatasetManifestAbout | null
  readonly viewOptions: DatasetViewOptionsModel
  readonly diagnostics: DatasetDiagnosticsModel
}

export interface DatasetFact {
  readonly label: string
  readonly value: string
}

export interface DatasetFactsInput {
  readonly platform: AppPlatformKind
  readonly url: string
  // 'cells', 'spots' or 'bins'.
  readonly elementNoun: string
  readonly elementCount: number
  readonly geneCount: number | null
  readonly channelCount: number
  readonly zPlaneCount: number
  // A single RGB tissue image (Visium) rather than channels.
  readonly hasFlatImage: boolean
  readonly micrometersPerPixel: number | undefined
}

function imageFact(input: DatasetFactsInput): string {
  if (input.channelCount === 0) {
    return input.hasFlatImage ? 'Tissue image' : 'None'
  }

  const channels = `${input.channelCount.toLocaleString()} ${
    input.channelCount === 1 ? 'channel' : 'channels'
  }`
  return input.zPlaneCount > 1
    ? `${channels} · ${input.zPlaneCount.toLocaleString()} z planes`
    : channels
}

// Platform, counts, image, pixel size and address, exact where the top bar's
// summary chip rounds.
export function datasetFacts(input: DatasetFactsInput): readonly DatasetFact[] {
  const facts: DatasetFact[] = [
    { label: 'Platform', value: PLATFORM_NAMES[input.platform] },
  ]

  if (input.platform !== 'image') {
    facts.push({
      label: input.elementNoun.charAt(0).toUpperCase() + input.elementNoun.slice(1),
      value: input.elementCount.toLocaleString(),
    })
  }

  if (input.geneCount !== null) {
    facts.push({ label: 'Genes', value: input.geneCount.toLocaleString() })
  }

  facts.push({ label: 'Image', value: imageFact(input) })

  if (input.micrometersPerPixel !== undefined) {
    facts.push({
      label: 'Pixel size',
      value: `${input.micrometersPerPixel.toLocaleString(undefined, {
        maximumSignificantDigits: 4,
      })} µm/px`,
    })
  }

  facts.push({ label: 'Address', value: input.url })
  return facts
}

export interface OpenDatasetModel {
  readonly datasetUrl: string
  readonly onDatasetUrlChange: (url: string) => void
  readonly shouldLoadMorphology: boolean
  readonly onShouldLoadMorphologyChange: (enabled: boolean) => void
  // "Tissue image" on Visium and Visium HD, "Morphology image" elsewhere.
  readonly morphologyLabel: string
  readonly boundaryCellLimit: number
  readonly maxBoundaryCellLimit: number
  readonly boundaryLimitDisabled: boolean
  readonly onBoundaryCellLimitChange: (limit: number) => void
  readonly isLoading: boolean
  readonly onSubmit: FormEventHandler<HTMLFormElement>
}

export interface ShareLinkModel {
  // A dataset is loaded, so the link opens it.
  readonly canCopyLink: boolean
  // Resolves false when the clipboard refused.
  readonly onCopyLink: () => Promise<boolean>
}

// Platform view choices. Visium HD bin size is in the Bins
// section and the Visium tissue image and off-tissue spots to the Image and
// Spots sections; the Visium library and SpatialData choices stay here.
export interface DatasetViewOptionsModel {
  readonly visiumHd: {
    readonly state: VisiumHdControlState
    readonly onBinSizeChange: (binSize: VisiumHdBinSizeMicrometers) => void
  }
  readonly visium: {
    readonly state: VisiumControlState
    readonly disabled: boolean
    readonly onImageChange: (image: VisiumImageKind | null) => void
    readonly onViewChange: (view: AnnDataVisiumView) => void
  }
  readonly spatialData: {
    readonly state: SpatialDataControlState
    readonly disabled: boolean
    readonly onSelectionChange: (selection: SpatialDataSelection) => void
  }
}

export interface DatasetDiagnosticsModel {
  readonly state: DatasetDiagnosticsState<StructuredLoadError>
  // Diagnose needs an address.
  readonly canRun: boolean
  readonly onRun: () => void
  readonly onDownload: () => void
  readonly matrixState: CellFeatureMatrixCapabilityState
  readonly fallbackNotices: readonly FallbackNoticeEntry[]
  readonly errors: readonly StructuredLoadError[]
  readonly log: readonly DebugLogEntry[]
  readonly onClearLog: () => void
  // The deck.gl layer and budget lines, only with ?debug=1.
  readonly layerStack: LayerStackInfo | null
}

export interface LayerStackInfo {
  readonly deckLayerCount: number
  readonly deckVersion: string
  readonly performanceBudget: PerformanceBudget
}

export interface DatasetInfoModelInput {
  readonly activeErrors: readonly StructuredLoadError[]
  readonly appendDebugEvent: AppendDebugEvent
  readonly boundaryCellLimit: number
  readonly cellFeatureMatrixCapabilityState: CellFeatureMatrixCapabilityState
  readonly datasetAbout: DatasetManifestAbout | null
  // The loaded dataset, once it is ready.
  readonly datasetFactsInput: DatasetFactsInput | null
  readonly datasetUrl: string
  readonly debugLog: readonly DebugLogEntry[]
  readonly debugMode: boolean
  readonly diagnosticsState: DatasetDiagnosticsState<StructuredLoadError>
  readonly fallbackNotices: readonly FallbackNoticeEntry[]
  readonly handleDatasetSubmit: FormEventHandler<HTMLFormElement>
  readonly handleDownloadDiagnostics: () => void
  readonly handleRunDatasetDiagnostics: () => Promise<void>
  readonly handleSpatialDataSelectionChange: (selection: SpatialDataSelection) => void
  readonly handleVisiumHdBinSizeChange: (
    binSize: VisiumHdBinSizeMicrometers,
  ) => Promise<void>
  readonly handleVisiumImageChange: (image: VisiumImageKind | null) => void
  readonly handleVisiumViewChange: (view: AnnDataVisiumView) => void
  readonly isDatasetLoaded: boolean
  readonly isLoading: boolean
  readonly isVisiumHdDataset: boolean
  readonly performanceBudget: PerformanceBudget
  readonly setBoundaryCellLimit: Dispatch<SetStateAction<number>>
  readonly setDatasetUrl: (url: string) => void
  readonly setDebugLog: Dispatch<SetStateAction<readonly DebugLogEntry[]>>
  readonly setShouldLoadMorphology: Dispatch<SetStateAction<boolean>>
  // The link for the current state, which the address shows up to 160 ms
  // later (useShareableUrlHash).
  readonly shareUrl: () => string
  readonly shouldLoadMorphology: boolean
  readonly spatialDataControlState: SpatialDataControlState
  readonly visiumControlState: VisiumControlState
  readonly visiumHdControlState: VisiumHdControlState
}

export function useDatasetInfoModel({
  activeErrors,
  appendDebugEvent,
  boundaryCellLimit,
  cellFeatureMatrixCapabilityState,
  datasetAbout,
  datasetFactsInput,
  datasetUrl,
  debugLog,
  debugMode,
  diagnosticsState,
  fallbackNotices,
  handleDatasetSubmit,
  handleDownloadDiagnostics,
  handleRunDatasetDiagnostics,
  handleSpatialDataSelectionChange,
  handleVisiumHdBinSizeChange,
  handleVisiumImageChange,
  handleVisiumViewChange,
  isDatasetLoaded,
  isLoading,
  isVisiumHdDataset,
  performanceBudget,
  setBoundaryCellLimit,
  setDatasetUrl,
  setDebugLog,
  setShouldLoadMorphology,
  shareUrl,
  shouldLoadMorphology,
  spatialDataControlState,
  visiumControlState,
  visiumHdControlState,
}: DatasetInfoModelInput): DatasetInfoModel {
  return {
    facts: datasetFactsInput === null ? [] : datasetFacts(datasetFactsInput),
    open: {
      datasetUrl,
      onDatasetUrlChange: setDatasetUrl,
      shouldLoadMorphology,
      onShouldLoadMorphologyChange: (checked) => {
        setShouldLoadMorphology(checked)
        appendDebugEvent(
          checked ? 'Morphology image enabled' : 'Morphology image disabled',
        )
      },
      morphologyLabel:
        isVisiumHdDataset || visiumControlState.status !== 'idle'
          ? 'Tissue image'
          : 'Morphology image',
      boundaryCellLimit,
      maxBoundaryCellLimit: MAX_BOUNDARY_VIEWPORT_CELL_LIMIT,
      boundaryLimitDisabled: isVisiumHdDataset,
      onBoundaryCellLimitChange: (value) => {
        const nextLimit = normalizeBoundaryCellLimit(value)
        setBoundaryCellLimit(nextLimit)
        appendDebugEvent(`Boundary limit: ${nextLimit.toLocaleString()}`, {
          coalesceKey: 'boundary-limit',
        })
      },
      isLoading,
      onSubmit: handleDatasetSubmit,
    },
    share: {
      canCopyLink: isDatasetLoaded,
      onCopyLink: async () => {
        try {
          await navigator.clipboard.writeText(shareUrl())
          appendDebugEvent('Link copied')
          return true
        } catch {
          return false
        }
      },
    },
    about: datasetAbout,
    viewOptions: {
      visiumHd: {
        state: visiumHdControlState,
        onBinSizeChange: (binSize) => {
          void handleVisiumHdBinSizeChange(binSize)
        },
      },
      visium: {
        state: visiumControlState,
        disabled: isLoading || visiumControlState.status === 'loading',
        onImageChange: handleVisiumImageChange,
        onViewChange: handleVisiumViewChange,
      },
      spatialData: {
        state: spatialDataControlState,
        disabled: isLoading || spatialDataControlState.status === 'loading',
        onSelectionChange: handleSpatialDataSelectionChange,
      },
    },
    diagnostics: {
      state: diagnosticsState,
      canRun: datasetUrl.trim() !== '',
      onRun: () => {
        void handleRunDatasetDiagnostics()
      },
      onDownload: handleDownloadDiagnostics,
      matrixState: cellFeatureMatrixCapabilityState,
      fallbackNotices,
      errors: activeErrors,
      log: debugLog,
      onClearLog: () => {
        setDebugLog([])
      },
      layerStack: debugMode
        ? {
            deckLayerCount: scaffoldDeckLayerCount,
            deckVersion: bundledDeckVersion,
            performanceBudget,
          }
        : null,
    },
  }
}
