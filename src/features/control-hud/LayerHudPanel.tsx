import type { ViewerCoordinateUnit } from '../../components/ViewerCore'
import type { MorphologyImageChannel } from '../../data/morphologyImage'
import type { PerformanceBudget } from '../../data/performanceBudget'
import { MorphologyChannelControls } from '../morphology/MorphologyChannelControls'
import type { MorphologyChannelSetting } from '../morphology/morphologyChannels'
import { opacityToPercent } from '../../rendering/layerOpacity'

interface LayerHudPanelProps {
  readonly active: boolean
  readonly scaffoldDeckLayerCount: number
  readonly bundledDeckVersion: string
  readonly performanceBudget: PerformanceBudget
  readonly imageOpacityInputId: string
  readonly cellFillOpacityInputId: string
  readonly cellBoundaryOpacityInputId: string
  readonly coordinateUnitInputId: string
  readonly measurementModeInputId: string
  readonly measurementUnitInputId: string
  readonly imageLayerOpacity: number
  readonly cellFillOpacity: number
  readonly cellBoundaryOpacity: number
  readonly coordinateUnit: ViewerCoordinateUnit
  readonly measurementEnabled: boolean
  readonly measurementUnit: ViewerCoordinateUnit
  readonly morphologyChannels: readonly MorphologyImageChannel[]
  readonly morphologyChannelSettings: readonly MorphologyChannelSetting[]
  readonly autoContrastChannelIds: readonly string[]
  readonly onImageLayerOpacityPercentChange: (percent: number) => void
  readonly onCellFillOpacityPercentChange: (percent: number) => void
  readonly onCellBoundaryOpacityPercentChange: (percent: number) => void
  readonly onCoordinateUnitChange: (unit: ViewerCoordinateUnit) => void
  readonly onMeasurementEnabledChange: (enabled: boolean) => void
  readonly onMeasurementUnitChange: (unit: ViewerCoordinateUnit) => void
  readonly onClearMeasurement: () => void
  readonly onAutoContrast: (channel: MorphologyImageChannel) => void
  readonly onUpdateMorphologyChannel: (
    id: string,
    patch: Partial<Omit<MorphologyChannelSetting, 'id'>>,
  ) => void
}

export function LayerHudPanel({
  active,
  scaffoldDeckLayerCount,
  bundledDeckVersion,
  performanceBudget,
  imageOpacityInputId,
  cellFillOpacityInputId,
  cellBoundaryOpacityInputId,
  coordinateUnitInputId,
  measurementModeInputId,
  measurementUnitInputId,
  imageLayerOpacity,
  cellFillOpacity,
  cellBoundaryOpacity,
  coordinateUnit,
  measurementEnabled,
  measurementUnit,
  morphologyChannels,
  morphologyChannelSettings,
  autoContrastChannelIds,
  onImageLayerOpacityPercentChange,
  onCellFillOpacityPercentChange,
  onCellBoundaryOpacityPercentChange,
  onCoordinateUnitChange,
  onMeasurementEnabledChange,
  onMeasurementUnitChange,
  onClearMeasurement,
  onAutoContrast,
  onUpdateMorphologyChannel,
}: LayerHudPanelProps) {
  const imageOpacityPercent = opacityToPercent(imageLayerOpacity)
  const cellFillOpacityPercent = opacityToPercent(cellFillOpacity)
  const cellBoundaryOpacityPercent = opacityToPercent(cellBoundaryOpacity)

  return (
    <div
      id="hud-panel-layers"
      className="hud-tab-panel"
      role="tabpanel"
      aria-labelledby="hud-tab-layers"
      hidden={!active}
    >
      <section className="layer-section" aria-labelledby="layer-heading">
        <h2 id="layer-heading">Layer Stack</h2>
        <p>
          {scaffoldDeckLayerCount} Deck Layer - deck.gl {bundledDeckVersion}
        </p>
        <p>
          Budget {performanceBudget.profile} -{' '}
          {performanceBudget.overviewRenderCellLimit.toLocaleString()} cells -{' '}
          {performanceBudget.maxConcurrentTileRequests} tile requests
        </p>
        <div className="layer-opacity-controls">
          <div className="layer-opacity-control">
            <div className="layer-opacity-header">
              <label htmlFor={imageOpacityInputId}>Image opacity</label>
              <span>{imageOpacityPercent}%</span>
            </div>
            <input
              id={imageOpacityInputId}
              type="range"
              min="0"
              max="100"
              step="5"
              value={imageOpacityPercent}
              aria-valuetext={`${imageOpacityPercent}%`}
              title="Image opacity"
              onChange={(event) => {
                onImageLayerOpacityPercentChange(event.currentTarget.valueAsNumber)
              }}
            />
          </div>
          <div className="layer-opacity-control">
            <div className="layer-opacity-header">
              <label htmlFor={cellFillOpacityInputId}>Cell fill opacity</label>
              <span>{cellFillOpacityPercent}%</span>
            </div>
            <input
              id={cellFillOpacityInputId}
              type="range"
              min="0"
              max="100"
              step="5"
              value={cellFillOpacityPercent}
              aria-valuetext={`${cellFillOpacityPercent}%`}
              title="Cell fill opacity"
              onChange={(event) => {
                onCellFillOpacityPercentChange(event.currentTarget.valueAsNumber)
              }}
            />
          </div>
          <div className="layer-opacity-control">
            <div className="layer-opacity-header">
              <label htmlFor={cellBoundaryOpacityInputId}>Cell boundary opacity</label>
              <span>{cellBoundaryOpacityPercent}%</span>
            </div>
            <input
              id={cellBoundaryOpacityInputId}
              type="range"
              min="0"
              max="100"
              step="5"
              value={cellBoundaryOpacityPercent}
              aria-valuetext={`${cellBoundaryOpacityPercent}%`}
              title="Cell boundary opacity"
              onChange={(event) => {
                onCellBoundaryOpacityPercentChange(event.currentTarget.valueAsNumber)
              }}
            />
          </div>
        </div>
        <div className="coordinate-unit-control">
          <span id={coordinateUnitInputId}>Mouse coordinates</span>
          <div
            className="coordinate-unit-segmented"
            role="group"
            aria-labelledby={coordinateUnitInputId}
          >
            <button
              type="button"
              aria-pressed={coordinateUnit === 'um'}
              title="Show mouse coordinates in micrometers"
              onClick={() => {
                onCoordinateUnitChange('um')
              }}
            >
              μm
            </button>
            <button
              type="button"
              aria-pressed={coordinateUnit === 'px'}
              title="Show mouse coordinates in pixels"
              onClick={() => {
                onCoordinateUnitChange('px')
              }}
            >
              px
            </button>
          </div>
        </div>
        <div className="measurement-control">
          <div className="measurement-control-header">
            <span id={measurementModeInputId}>Distance measure</span>
            <button
              type="button"
              aria-pressed={measurementEnabled}
              aria-labelledby={measurementModeInputId}
              title={
                measurementEnabled
                  ? 'Disable distance measure'
                  : 'Enable distance measure'
              }
              onClick={() => {
                onMeasurementEnabledChange(!measurementEnabled)
              }}
            >
              {measurementEnabled ? 'On' : 'Off'}
            </button>
          </div>
          <div className="coordinate-unit-control">
            <span id={measurementUnitInputId}>Measure unit</span>
            <div
              className="coordinate-unit-segmented"
              role="group"
              aria-labelledby={measurementUnitInputId}
            >
              <button
                type="button"
                aria-pressed={measurementUnit === 'um'}
                title="Measure distances in micrometers"
                onClick={() => {
                  onMeasurementUnitChange('um')
                }}
              >
                μm
              </button>
              <button
                type="button"
                aria-pressed={measurementUnit === 'px'}
                title="Measure distances in pixels"
                onClick={() => {
                  onMeasurementUnitChange('px')
                }}
              >
                px
              </button>
            </div>
          </div>
          <button
            type="button"
            className="secondary-action measurement-clear-action"
            title="Clear measurement"
            onClick={onClearMeasurement}
          >
            Clear Measurement
          </button>
        </div>
        <MorphologyChannelControls
          channels={morphologyChannels}
          settings={morphologyChannelSettings}
          autoContrastChannelIds={autoContrastChannelIds}
          onAutoContrast={onAutoContrast}
          onUpdate={onUpdateMorphologyChannel}
        />
      </section>
    </div>
  )
}
