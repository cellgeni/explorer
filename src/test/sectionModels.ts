import { vi } from 'vitest'
import type {
  AnnotationSetsModel,
  AnnotationsSectionModel,
  GeometricShapesModel,
  MetadataTracksModel,
} from '../features/sections/annotationsSectionModel'
import type {
  CellAppearanceModel,
  CellColourModel,
  CellsSectionModel,
  GeneSelectionModel,
} from '../features/sections/cellsSectionModel'
import type {
  DatasetDiagnosticsModel,
  DatasetInfoModel,
  DatasetViewOptionsModel,
  OpenDatasetModel,
  ShareLinkModel,
} from '../features/sections/datasetInfoModel'
import type {
  CustomImageLayersModel,
  ImageSectionModel,
} from '../features/sections/imageSectionModel'
import type {
  TranscriptFeatureModel,
  TranscriptsSectionModel,
} from '../features/sections/transcriptsSectionModel'
import type {
  MeasureToolModel,
  ViewSettingsModel,
} from '../features/sections/viewSettingsModel'
import type { ToolGroupModel, TopBarModel } from '../features/shell/topBarModel'
import { toolOptions } from '../features/shell/topBarModel'

// Section models for block and HUD panel tests (UNIFIED_PLAN.md, 15.2-A):
// an idle dataset with every callback a mock, plus the given overrides.

export function testImageSectionModel(
  overrides: Partial<Omit<ImageSectionModel, 'customLayers'>> & {
    readonly customLayers?: Partial<CustomImageLayersModel>
  } = {},
): ImageSectionModel {
  const { customLayers, ...rest } = overrides

  return {
    opacity: 1,
    onOpacityPercentChange: vi.fn(),
    zStack: undefined,
    requestedZPlane: null,
    onZPlaneChange: vi.fn(),
    channels: [],
    channelSettings: [],
    autoContrastChannelIds: [],
    onAutoContrast: vi.fn(),
    onUpdateChannel: vi.fn(),
    ...rest,
    customLayers: {
      loadEnabled: true,
      layers: [],
      loadState: { status: 'idle' },
      opacities: {},
      onLoad: vi.fn(async () => true),
      onRemove: vi.fn(),
      onOpacityPercentChange: vi.fn(),
      ...customLayers,
    },
  }
}

export function testCellsSectionModel(
  overrides: {
    readonly appearance?: Partial<CellAppearanceModel>
    readonly genes?: Partial<GeneSelectionModel>
    readonly colour?: Partial<CellColourModel>
  } = {},
): CellsSectionModel {
  return {
    appearance: {
      available: true,
      nucleusBoundariesAvailable: true,
      showCellBoundaries: true,
      onShowCellBoundariesChange: vi.fn(),
      showNucleusBoundaries: true,
      onShowNucleusBoundariesChange: vi.fn(),
      fillOpacity: 1,
      onFillOpacityPercentChange: vi.fn(),
      boundaryOpacity: 1,
      onBoundaryOpacityPercentChange: vi.fn(),
      ...overrides.appearance,
    },
    genes: {
      panelState: { status: 'idle' },
      options: [],
      selected: [],
      scoreMode: 'sum',
      onToggle: vi.fn(),
      onApply: vi.fn(),
      log: vi.fn(),
      ...overrides.genes,
    },
    colour: {
      headerCopy: 'Idle',
      statusCopy: '',
      isLoading: false,
      mode: 'transcript-count',
      onModeChange: vi.fn(),
      hasAnnotationColors: false,
      metadataTracks: [],
      selectedMetadataTrackId: null,
      onMetadataTrackChange: vi.fn(),
      selectedGeneCount: 0,
      scoreMode: 'sum',
      onScoreModeChange: vi.fn(),
      colorScale: 'viridis',
      onColorScaleChange: vi.fn(),
      scaleMax: 1,
      detailMode: 'auto',
      onDetailModeChange: vi.fn(),
      ...overrides.colour,
    },
  }
}

export function testViewSettingsModel(
  overrides: Partial<Omit<ViewSettingsModel, 'measure'>> & {
    readonly measure?: Partial<MeasureToolModel>
  } = {},
): ViewSettingsModel {
  const { measure, ...rest } = overrides

  return {
    showHoverTooltips: true,
    onShowHoverTooltipsChange: vi.fn(),
    coordinateUnit: 'um',
    onCoordinateUnitChange: vi.fn(),
    ...rest,
    measure: {
      enabled: false,
      onEnabledChange: vi.fn(),
      unit: 'um',
      onUnitChange: vi.fn(),
      onClear: vi.fn(),
      ...measure,
    },
  }
}

export function testDatasetInfoModel(
  overrides: {
    readonly open?: Partial<OpenDatasetModel>
    readonly share?: Partial<ShareLinkModel>
    readonly about?: DatasetInfoModel['about']
    readonly viewOptions?: {
      readonly [Key in keyof DatasetViewOptionsModel]?: Partial<
        DatasetViewOptionsModel[Key]
      >
    }
    readonly diagnostics?: Partial<DatasetDiagnosticsModel>
    readonly facts?: DatasetInfoModel['facts']
  } = {},
): DatasetInfoModel {
  return {
    facts: overrides.facts ?? [],
    open: {
      datasetUrl: '',
      onDatasetUrlChange: vi.fn(),
      shouldLoadMorphology: true,
      onShouldLoadMorphologyChange: vi.fn(),
      morphologyLabel: 'Morphology image',
      boundaryCellLimit: 50_000,
      maxBoundaryCellLimit: 100_000,
      boundaryLimitDisabled: false,
      onBoundaryCellLimitChange: vi.fn(),
      isLoading: false,
      onSubmit: vi.fn((event: { preventDefault: () => void }) => {
        event.preventDefault()
      }),
      ...overrides.open,
    },
    share: {
      canCopyLink: false,
      onCopyLink: vi.fn(async () => true),
      ...overrides.share,
    },
    about: overrides.about ?? null,
    viewOptions: {
      visiumHd: {
        state: { status: 'idle' },
        onBinSizeChange: vi.fn(),
        ...overrides.viewOptions?.visiumHd,
      },
      visium: {
        state: { status: 'idle' },
        disabled: false,
        onImageChange: vi.fn(),
        onViewChange: vi.fn(),
        ...overrides.viewOptions?.visium,
      },
      spatialData: {
        state: { status: 'idle' },
        disabled: false,
        onSelectionChange: vi.fn(),
        ...overrides.viewOptions?.spatialData,
      },
    },
    diagnostics: {
      state: { status: 'idle' },
      canRun: false,
      onRun: vi.fn(),
      onDownload: vi.fn(),
      matrixState: { status: 'idle' },
      fallbackNotices: [],
      errors: [],
      log: [],
      onClearLog: vi.fn(),
      layerStack: null,
      ...overrides.diagnostics,
    },
  }
}

export function testTranscriptsSectionModel(
  overrides: Partial<Omit<TranscriptsSectionModel, 'features'>> & {
    readonly features?: Partial<TranscriptFeatureModel>
  } = {},
): TranscriptsSectionModel {
  const { features, ...rest } = overrides

  return {
    loadEnabled: true,
    headerCopy: 'Idle',
    isLoading: false,
    capabilityState: { status: 'idle' },
    layerState: { status: 'idle' },
    visibleEstimate: 0,
    show: false,
    onShowChange: vi.fn(),
    detailMode: 'auto',
    onDetailModeChange: vi.fn(),
    exactPointLimit: 100_000,
    onExactPointLimitChange: vi.fn(),
    onLoadExactViewport: vi.fn(),
    densityColorScale: 'magma',
    onDensityColorScaleChange: vi.fn(),
    densityScaleMax: undefined,
    densityScaleLabels: ['0', '', ''],
    pointColorMode: 'feature',
    onPointColorModeChange: vi.fn(),
    minQv: 20,
    onMinQvChange: vi.fn(),
    geneOnly: true,
    geneOnlyFilterEnabled: true,
    onGeneOnlyChange: vi.fn(),
    opacity: 1,
    onOpacityPercentChange: vi.fn(),
    pointSize: 2,
    onPointSizeChange: vi.fn(),
    hoveredTranscript: null,
    pinnedTranscript: null,
    onPinTranscript: vi.fn(),
    onClearPinnedTranscript: vi.fn(),
    ...rest,
    features: {
      filterMode: 'all',
      onFilterModeChange: vi.fn(),
      panelState: { status: 'idle' },
      options: [],
      selected: [],
      onToggle: vi.fn(),
      onPick: vi.fn(() => true),
      ...features,
    },
  }
}

export function testAnnotationsSectionModel(
  overrides: {
    readonly headerCopy?: string
    readonly isLoading?: boolean
    readonly sets?: Partial<AnnotationSetsModel>
    readonly metadataTracks?: Partial<MetadataTracksModel>
    readonly shapes?: Partial<GeometricShapesModel>
  } = {},
): AnnotationsSectionModel {
  return {
    headerCopy: overrides.headerCopy ?? 'Idle',
    isLoading: overrides.isLoading ?? false,
    sets: {
      available: true,
      loadEnabled: true,
      selectedGroupId: '',
      groupOptions: [],
      onGroupChange: vi.fn(),
      state: { status: 'idle' },
      groupState: { status: 'idle' },
      onLoad: vi.fn(),
      canClear: false,
      onClear: vi.fn(),
      onExport: vi.fn(),
      onImportFile: vi.fn(),
      importUrl: '',
      onImportUrlChange: vi.fn(),
      isImportingUrl: false,
      onImportUrl: vi.fn(async () => {}),
      colors: {},
      hiddenSetIds: [],
      hiddenIds: [],
      placedCellIds: null,
      onColorChange: vi.fn(),
      onSetVisibilityChange: vi.fn(),
      onVisibilityChange: vi.fn(),
      onRemove: vi.fn(),
      ...overrides.sets,
    },
    metadataTracks: {
      tracks: [],
      onRemove: vi.fn(),
      ...overrides.metadataTracks,
    },
    shapes: {
      enabled: true,
      shapes: [],
      onImportFile: vi.fn(),
      onExport: vi.fn(),
      onClear: vi.fn(),
      onColorChange: vi.fn(),
      onVisibilityChange: vi.fn(),
      onRemove: vi.fn(),
      ...overrides.shapes,
    },
  }
}

export function testTopBarModel(
  overrides: Partial<Omit<TopBarModel, 'tools'>> & {
    readonly tools?: Partial<ToolGroupModel>
  } = {},
): TopBarModel {
  const { tools, ...rest } = overrides

  return {
    datasetName: 'Sob23 brain',
    summary: { status: 'ready', text: 'Xenium · 1.41 M cells · 5,001 genes' },
    magicLens: {
      radiusMicrometers: 80,
      onRadiusChange: vi.fn(),
      canSummariseView: true,
      onSummariseView: vi.fn(),
    },
    debugMode: false,
    onDebugModeChange: vi.fn(),
    ...rest,
    tools: {
      active: 'pan',
      options: toolOptions({
        datasetReady: true,
        canDrawRoi: true,
        magicLens: { enabled: true },
      }),
      onSelect: vi.fn(),
      ...tools,
    },
  }
}
