import { useSyncExternalStore } from 'react'
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
import {
  subscribeZarrCodecWorkerFailure,
  zarrCodecWorkerFailure,
  zarrCodecWorkerNotice,
  type ZarrCodecWorkerFailure,
} from '../../zarr/zarrCodecWorkerStatus'
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
import type { MerscopeImageControlState } from '../dataset/merscopeImageModel'
import type { AteraImageChoice, AteraImageControlState } from '../dataset/ateraImageModel'
import type { MerscopeImageChoice } from '../../datasets/merscopeDataset'
import type { StructuredLoadError } from '../errors/loadErrorModel'
import { PLATFORM_NAMES, type AppPlatformKind } from '../app-shell/platformAdapter'
import type { ImagePyramidLoader } from '../../data/imagePyramid'
import { micrometersPerPixelY } from '../../data/coords'
import type { SlideImagesSource } from './slideImagesModel'

// The dataset itself: opening one, sharing it, what it is, its view options
// and diagnostics (plan 15.2-A): the info drawer, the dataset
// menu, Share and Settings.
export interface DatasetInfoModel {
  // What is open, for the info drawer's Dataset section (15.2-F). Empty
  // before a dataset is ready.
  readonly facts: readonly DatasetFact[]
  // The dataset image, when it stores slide images beside it (SVS).
  readonly slideImages: SlideImagesSource | null
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
  // The image's full-resolution pixels and extent; null without an image or
  // when its size is not known (a hosted Visium PNG).
  readonly imageSize: DatasetImageSize | null
  readonly micrometersPerPixel: number | undefined
}

export interface DatasetImageSize {
  readonly width: number
  readonly height: number
  readonly widthMicrometers: number
  readonly heightMicrometers: number
}

// A pyramid's level 0, or a flat tissue image (a Visium hires or lowres PNG)
// scaled back to the full-resolution pixels its scale factor is from.
export function datasetImageSize(
  loader: ImagePyramidLoader | null,
  flatImage: {
    readonly size?: readonly [number, number]
    readonly scaleFactor: number
    readonly micrometersPerPixel: number
  } | null,
): DatasetImageSize | null {
  if (loader !== null) {
    return {
      width: loader.imageWidth,
      height: loader.imageHeight,
      widthMicrometers: loader.imageWidth * loader.units.micrometersPerPixel,
      heightMicrometers: loader.imageHeight * micrometersPerPixelY(loader.units),
    }
  }

  if (flatImage?.size === undefined || !(flatImage.scaleFactor > 0)) {
    return null
  }

  const width = Math.round(flatImage.size[0] / flatImage.scaleFactor)
  const height = Math.round(flatImage.size[1] / flatImage.scaleFactor)
  return {
    width,
    height,
    widthMicrometers: width * flatImage.micrometersPerPixel,
    heightMicrometers: height * flatImage.micrometersPerPixel,
  }
}

function lengthText(micrometers: number, unit: 'µm' | 'mm'): string {
  return (unit === 'mm' ? micrometers / 1000 : micrometers).toLocaleString(undefined, {
    maximumSignificantDigits: 3,
  })
}

// "40,960 × 31,232 px · 8.7 × 6.64 mm", the extent only when the image is
// calibrated (it has a pixel size).
function imageSizeFact(size: DatasetImageSize, calibrated: boolean): string {
  const pixels = `${size.width.toLocaleString()} × ${size.height.toLocaleString()} px`

  if (!calibrated) {
    return pixels
  }

  const unit =
    Math.max(size.widthMicrometers, size.heightMicrometers) >= 1000 ? 'mm' : 'µm'
  return `${pixels} · ${lengthText(size.widthMicrometers, unit)} × ${lengthText(
    size.heightMicrometers,
    unit,
  )} ${unit}`
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

// Platform, counts, image, its size, pixel size and address, exact where the top bar's
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

  if (input.imageSize !== null) {
    facts.push({
      label: 'Image size',
      value: imageSizeFact(input.imageSize, input.micrometersPerPixel !== undefined),
    })
  }

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
  // Opens the structure drawer on a Zarr store's or a Parquet file's address.
  readonly onBrowseStructure: (url: string) => void
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
  readonly merscope: {
    readonly state: MerscopeImageControlState
    readonly disabled: boolean
    readonly onImageChange: (choice: MerscopeImageChoice | null) => void
  }
  readonly atera: {
    readonly state: AteraImageControlState
    readonly disabled: boolean
    readonly onImageChange: (choice: AteraImageChoice) => void
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
  // The dataset's image, once it is open.
  readonly datasetImageLoader: ImagePyramidLoader | null
  readonly datasetUrl: string
  readonly debugLog: readonly DebugLogEntry[]
  readonly debugMode: boolean
  readonly diagnosticsState: DatasetDiagnosticsState<StructuredLoadError>
  readonly fallbackNotices: readonly FallbackNoticeEntry[]
  readonly handleBrowseStructure: (url: string) => void
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
  readonly merscopeImageState: MerscopeImageControlState
  readonly handleMerscopeImageChange: (choice: MerscopeImageChoice | null) => void
  readonly ateraImageState: AteraImageControlState
  readonly handleAteraImageChange: (choice: AteraImageChoice) => void
}

export function useDatasetInfoModel({
  activeErrors,
  appendDebugEvent,
  boundaryCellLimit,
  cellFeatureMatrixCapabilityState,
  datasetAbout,
  datasetFactsInput,
  datasetImageLoader,
  datasetUrl,
  debugLog,
  debugMode,
  diagnosticsState,
  fallbackNotices,
  handleBrowseStructure,
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
  merscopeImageState,
  handleMerscopeImageChange,
  ateraImageState,
  handleAteraImageChange,
}: DatasetInfoModelInput): DatasetInfoModel {
  const zarrWorkerFailure = useSyncExternalStore(
    subscribeZarrCodecWorkerFailure,
    zarrCodecWorkerFailure,
  )

  return {
    facts: datasetFactsInput === null ? [] : datasetFacts(datasetFactsInput),
    slideImages: slideImagesSource(datasetImageLoader),
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
      onBrowseStructure: handleBrowseStructure,
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
      merscope: {
        state: merscopeImageState,
        disabled: isLoading || merscopeImageState.status === 'loading',
        onImageChange: handleMerscopeImageChange,
      },
      atera: {
        state: ateraImageState,
        disabled: isLoading || ateraImageState.status === 'loading',
        onImageChange: handleAteraImageChange,
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
      fallbackNotices: withZarrCodecWorkerNotice(fallbackNotices, zarrWorkerFailure),
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

// The Zarr decode workers stay failed until the page is reloaded, so their
// notice is not kept with the dataset's, which each load clears. It takes ID
// 0; the dataset's notices are numbered from 1.
export function withZarrCodecWorkerNotice(
  notices: readonly FallbackNoticeEntry[],
  failure: ZarrCodecWorkerFailure | null,
): readonly FallbackNoticeEntry[] {
  return failure === null
    ? notices
    : [
        { id: 0, timestamp: failure.timestamp, ...zarrCodecWorkerNotice(failure) },
        ...notices,
      ]
}

function slideImagesSource(loader: ImagePyramidLoader | null): SlideImagesSource | null {
  return loader?.associatedImages === undefined
    ? null
    : (loader as ImagePyramidLoader & SlideImagesSource)
}
