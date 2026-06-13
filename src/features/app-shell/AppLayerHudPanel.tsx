import type { Dispatch, SetStateAction } from 'react'
import type { RoiDrawMode, ViewerCoordinateUnit } from '../../components/ViewerCore'
import { scaffoldDeckLayerCount } from '../../components/viewerCoreModel'
import type {
  CustomMorphologyLayer,
  CustomMorphologyLayerLoadState,
} from '../morphology/customMorphologyLayers'
import type { MorphologyImageChannel } from '../../data/morphologyImage'
import type { PerformanceBudget } from '../../data/performanceBudget'
import { bundledDeckVersion } from '../../rendering/deckLayers'
import { percentToOpacity } from '../../rendering/layerOpacity'
import { LayerHudPanel } from '../control-hud/LayerHudPanel'
import type { MorphologyChannelSetting } from '../morphology/morphologyChannels'
import type { DebugLogAppendOptions } from './appRuntimeModel'
import type { AppControlIds } from './useAppControlIds'

type AppLayerControlIds = Pick<
  AppControlIds,
  | 'imageOpacityInputId'
  | 'cellFillOpacityInputId'
  | 'cellBoundaryOpacityInputId'
  | 'coordinateUnitInputId'
  | 'measurementModeInputId'
  | 'measurementUnitInputId'
>

export interface AppLayerHudPanelProps {
  readonly active: boolean
  readonly appendDebugEvent: (message: string, options?: DebugLogAppendOptions) => void
  readonly autoContrastChannelIds: readonly string[]
  readonly cellBoundaryOpacity: number
  readonly cellFillOpacity: number
  readonly controlIds: AppLayerControlIds
  readonly coordinateUnit: ViewerCoordinateUnit
  readonly customLayerLoadState: CustomMorphologyLayerLoadState
  readonly customLayers: readonly CustomMorphologyLayer[]
  readonly customLayerOpacities: Readonly<Record<string, number>>
  readonly handleAutoContrast: (channel: MorphologyImageChannel) => void
  readonly handleMagicLensLeave: () => void
  readonly handleLoadCustomLayer: (url: string) => Promise<boolean>
  readonly handleRemoveCustomLayer: (layerId: string) => void
  readonly imageLayerOpacity: number
  readonly loadEnabled: boolean
  readonly measurementEnabled: boolean
  readonly measurementUnit: ViewerCoordinateUnit
  readonly morphologyChannelSettings: readonly MorphologyChannelSetting[]
  readonly morphologyChannels: readonly MorphologyImageChannel[]
  readonly performanceBudget: PerformanceBudget
  readonly setCellBoundaryOpacity: Dispatch<SetStateAction<number>>
  readonly setCellFillOpacity: Dispatch<SetStateAction<number>>
  readonly setCoordinateUnit: Dispatch<SetStateAction<ViewerCoordinateUnit>>
  readonly setCustomLayerOpacity: (imageUrl: string, opacity: number) => void
  readonly setImageLayerOpacity: Dispatch<SetStateAction<number>>
  readonly setMagicLensActive: Dispatch<SetStateAction<boolean>>
  readonly setMeasurementEnabled: Dispatch<SetStateAction<boolean>>
  readonly setMeasurementResetKey: Dispatch<SetStateAction<number>>
  readonly setMeasurementUnit: Dispatch<SetStateAction<ViewerCoordinateUnit>>
  readonly setRoiMode: Dispatch<SetStateAction<RoiDrawMode>>
  readonly updateMorphologyChannel: (
    id: string,
    patch: Partial<Omit<MorphologyChannelSetting, 'id'>>,
  ) => void
}

export function AppLayerHudPanel({
  active,
  appendDebugEvent,
  autoContrastChannelIds,
  cellBoundaryOpacity,
  cellFillOpacity,
  controlIds,
  coordinateUnit,
  customLayerLoadState,
  customLayers,
  customLayerOpacities,
  handleAutoContrast,
  handleMagicLensLeave,
  handleLoadCustomLayer,
  handleRemoveCustomLayer,
  imageLayerOpacity,
  loadEnabled,
  measurementEnabled,
  measurementUnit,
  morphologyChannelSettings,
  morphologyChannels,
  performanceBudget,
  setCellBoundaryOpacity,
  setCellFillOpacity,
  setCoordinateUnit,
  setCustomLayerOpacity,
  setImageLayerOpacity,
  setMagicLensActive,
  setMeasurementEnabled,
  setMeasurementResetKey,
  setMeasurementUnit,
  setRoiMode,
  updateMorphologyChannel,
}: AppLayerHudPanelProps) {
  return (
    <LayerHudPanel
      active={active}
      scaffoldDeckLayerCount={scaffoldDeckLayerCount}
      bundledDeckVersion={bundledDeckVersion}
      performanceBudget={performanceBudget}
      imageOpacityInputId={controlIds.imageOpacityInputId}
      cellFillOpacityInputId={controlIds.cellFillOpacityInputId}
      cellBoundaryOpacityInputId={controlIds.cellBoundaryOpacityInputId}
      coordinateUnitInputId={controlIds.coordinateUnitInputId}
      measurementModeInputId={controlIds.measurementModeInputId}
      measurementUnitInputId={controlIds.measurementUnitInputId}
      customLayerLoadState={customLayerLoadState}
      customLayers={customLayers}
      customLayerOpacities={customLayerOpacities}
      loadEnabled={loadEnabled}
      imageLayerOpacity={imageLayerOpacity}
      cellFillOpacity={cellFillOpacity}
      cellBoundaryOpacity={cellBoundaryOpacity}
      coordinateUnit={coordinateUnit}
      measurementEnabled={measurementEnabled}
      measurementUnit={measurementUnit}
      morphologyChannels={morphologyChannels}
      morphologyChannelSettings={morphologyChannelSettings}
      autoContrastChannelIds={autoContrastChannelIds}
      onImageLayerOpacityPercentChange={(nextPercent) => {
        setImageLayerOpacity(percentToOpacity(nextPercent))
        appendDebugEvent(`Dataset image opacity: ${nextPercent}%`, {
          coalesceKey: 'image-opacity',
        })
      }}
      onCustomLayerOpacityPercentChange={(imageUrl, nextPercent) => {
        setCustomLayerOpacity(imageUrl, percentToOpacity(nextPercent))
        appendDebugEvent(`Custom image opacity: ${nextPercent}%`, {
          coalesceKey: `custom-image-opacity:${imageUrl}`,
        })
      }}
      onCellFillOpacityPercentChange={(nextPercent) => {
        setCellFillOpacity(percentToOpacity(nextPercent))
        appendDebugEvent(`Cell fill opacity: ${nextPercent}%`, {
          coalesceKey: 'cell-fill-opacity',
        })
      }}
      onCellBoundaryOpacityPercentChange={(nextPercent) => {
        setCellBoundaryOpacity(percentToOpacity(nextPercent))
        appendDebugEvent(`Cell boundary opacity: ${nextPercent}%`, {
          coalesceKey: 'cell-boundary-opacity',
        })
      }}
      onCoordinateUnitChange={(nextUnit) => {
        if (coordinateUnit === nextUnit) {
          return
        }

        setCoordinateUnit(nextUnit)
        appendDebugEvent(`Mouse coordinates: ${nextUnit === 'um' ? 'μm' : 'px'}`, {
          coalesceKey: 'coordinate-unit',
        })
      }}
      onMeasurementEnabledChange={(nextEnabled) => {
        if (measurementEnabled === nextEnabled) {
          return
        }

        setMeasurementEnabled(nextEnabled)

        if (nextEnabled) {
          setRoiMode('idle')
          setMagicLensActive(false)
          handleMagicLensLeave()
        } else {
          setMeasurementResetKey((current) => current + 1)
        }

        appendDebugEvent(
          nextEnabled ? 'Distance measure enabled' : 'Distance measure disabled',
          { coalesceKey: 'measurement-mode' },
        )
      }}
      onMeasurementUnitChange={(nextUnit) => {
        if (measurementUnit === nextUnit) {
          return
        }

        setMeasurementUnit(nextUnit)
        appendDebugEvent(`Measure unit: ${nextUnit === 'um' ? 'μm' : 'px'}`, {
          coalesceKey: 'measurement-unit',
        })
      }}
      onClearMeasurement={() => {
        setMeasurementResetKey((current) => current + 1)
        appendDebugEvent('Distance measure cleared', {
          coalesceKey: 'measurement-clear',
        })
      }}
      onAutoContrast={handleAutoContrast}
      onLoadCustomLayer={handleLoadCustomLayer}
      onRemoveCustomLayer={handleRemoveCustomLayer}
      onUpdateMorphologyChannel={updateMorphologyChannel}
    />
  )
}
