import type { ActiveTool } from '../app-shell/activeToolModel'
import type { AppendDebugEvent } from '../app-shell/appRuntimeModel'
import type { AppPlatformKind } from '../app-shell/platformAdapter'
import type { MagicLensScope } from '../roi/magicLensModel'
import type { RoiDrawMode } from '../../components/ViewerCore'
import { TOOL_LABELS, TOOL_ORDER, TOOL_SHORTCUT_KEYS } from './shortcuts'

// The new shell's top bar (UNIFIED_PLAN.md, 15.2-B): the dataset name, a
// summary chip, the tools, and Share, Help and Settings.
export interface TopBarModel {
  // Null before a dataset is ready.
  readonly datasetName: string | null
  readonly summary: DatasetSummary
  readonly tools: ToolGroupModel
  readonly debugMode: boolean
  readonly onDebugModeChange: (enabled: boolean) => void
}

// The chip says what is open, and while a dataset loads, which one. It is
// also the "loaded" signal tests can wait for.
export type DatasetSummary =
  | { readonly status: 'empty' }
  | { readonly status: 'loading'; readonly name: string }
  | { readonly status: 'ready'; readonly text: string }

export interface ToolGroupModel {
  readonly active: ActiveTool
  readonly options: readonly ToolOption[]
  readonly onSelect: (tool: ActiveTool) => void
}

export interface ToolOption {
  readonly tool: ActiveTool
  readonly label: string
  readonly shortcut: string
  readonly disabled: boolean
  // Why the tool is off, for its tooltip.
  readonly reason?: string | undefined
}

const PLATFORM_LABELS: Readonly<Record<AppPlatformKind, string>> = {
  xenium: 'Xenium',
  atera: 'Atera',
  visium: 'Visium',
  'visium-hd': 'Visium HD',
  h5ad: 'H5AD',
  spatialdata: 'SpatialData',
  image: 'Image',
}

// "1.41 M" from a million up, so the chip stays short; exact below that.
export function formatCompactCount(count: number): string {
  if (count >= 1_000_000) {
    return `${Number((count / 1_000_000).toPrecision(3)).toLocaleString()} M`
  }

  return count.toLocaleString()
}

function plural(count: number, noun: string): string {
  return `${formatCompactCount(count)} ${count === 1 ? noun.replace(/s$/, '') : noun}`
}

export function datasetSummaryText({
  platform,
  elementCount,
  elementNoun,
  geneCount,
  channelCount,
}: {
  readonly platform: AppPlatformKind
  readonly elementCount: number
  readonly elementNoun: string
  readonly geneCount: number | null
  readonly channelCount: number
}): string {
  const parts = [PLATFORM_LABELS[platform]]

  if (platform === 'image') {
    if (channelCount > 0) parts.push(plural(channelCount, 'channels'))
  } else {
    parts.push(plural(elementCount, elementNoun))
    if (geneCount !== null) parts.push(plural(geneCount, 'genes'))
  }

  return parts.join(' · ')
}

export function toolOptions({
  datasetReady,
  canDrawRoi,
  magicLens,
}: {
  readonly datasetReady: boolean
  readonly canDrawRoi: boolean
  // Null where the platform has no Magic Lens (images).
  readonly magicLens: { readonly enabled: boolean; readonly reason?: string } | null
}): readonly ToolOption[] {
  return TOOL_ORDER.flatMap((tool): ToolOption[] => {
    const base = { tool, label: TOOL_LABELS[tool], shortcut: TOOL_SHORTCUT_KEYS[tool] }

    switch (tool) {
      case 'pan':
        return [{ ...base, disabled: false }]
      case 'box':
      case 'lasso':
        return [
          canDrawRoi
            ? { ...base, disabled: false }
            : {
                ...base,
                disabled: true,
                reason: datasetReady
                  ? 'The dataset is still preparing'
                  : 'Open a dataset',
              },
        ]
      case 'measure':
        return [
          datasetReady
            ? { ...base, disabled: false }
            : { ...base, disabled: true, reason: 'Open a dataset' },
        ]
      case 'magic-lens':
        if (magicLens === null) return []
        return [
          magicLens.enabled
            ? { ...base, disabled: false }
            : {
                ...base,
                disabled: true,
                reason: magicLens.reason ?? 'Open a dataset',
              },
        ]
    }
  })
}

export interface TopBarModelInput {
  readonly activeTool: ActiveTool
  readonly appendDebugEvent: AppendDebugEvent
  readonly canDrawRoi: boolean
  readonly channelCount: number
  readonly datasetName: string | null
  readonly debugMode: boolean
  readonly elementCount: number
  readonly elementNoun: string
  readonly geneCount: number | null
  // The dataset being opened, while one is.
  readonly loadingDatasetName: string | null
  readonly magicLensAvailable: boolean
  readonly magicLensEnabled: boolean
  readonly magicLensReason: string | undefined
  readonly magicLensScope: MagicLensScope
  readonly onMagicLensCursorActiveChange: (active: boolean) => void
  readonly onMagicLensScopeChange: (scope: MagicLensScope) => void
  readonly onMeasureEnabledChange: (enabled: boolean) => void
  readonly onReturnToPan: () => void
  readonly onRoiModeChange: (mode: RoiDrawMode) => void
  readonly platform: AppPlatformKind
  readonly setDebugMode: (enabled: boolean) => void
}

export function useTopBarModel({
  activeTool,
  appendDebugEvent,
  canDrawRoi,
  channelCount,
  datasetName,
  debugMode,
  elementCount,
  elementNoun,
  geneCount,
  loadingDatasetName,
  magicLensAvailable,
  magicLensEnabled,
  magicLensReason,
  magicLensScope,
  onMagicLensCursorActiveChange,
  onMagicLensScopeChange,
  onMeasureEnabledChange,
  onReturnToPan,
  onRoiModeChange,
  platform,
  setDebugMode,
}: TopBarModelInput): TopBarModel {
  const options = toolOptions({
    datasetReady: datasetName !== null,
    canDrawRoi,
    magicLens: magicLensAvailable
      ? {
          enabled: magicLensEnabled,
          ...(magicLensReason === undefined ? {} : { reason: magicLensReason }),
        }
      : null,
  })

  return {
    datasetName,
    summary:
      loadingDatasetName !== null
        ? { status: 'loading', name: loadingDatasetName }
        : datasetName === null
          ? { status: 'empty' }
          : {
              status: 'ready',
              text: datasetSummaryText({
                platform,
                elementCount,
                elementNoun,
                geneCount,
                channelCount,
              }),
            },
    tools: {
      active: activeTool,
      options,
      onSelect: (tool) => {
        const option = options.find((candidate) => candidate.tool === tool)
        if (option === undefined || option.disabled || tool === activeTool) return

        switch (tool) {
          case 'pan':
            onReturnToPan()
            return
          case 'box':
          case 'lasso':
            onRoiModeChange(tool)
            return
          case 'measure':
            onMeasureEnabledChange(true)
            return
          case 'magic-lens':
            // The tool is the cursor lens (D14).
            if (magicLensScope !== 'cursor') onMagicLensScopeChange('cursor')
            onMagicLensCursorActiveChange(true)
            return
        }
      },
    },
    debugMode,
    onDebugModeChange: (enabled) => {
      setDebugMode(enabled)
      appendDebugEvent(enabled ? 'Debug info shown' : 'Debug info hidden')
    },
  }
}
