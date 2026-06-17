import { useId, useState, type FormEvent } from 'react'
import type { ViewerCoordinateUnit } from '../../components/ViewerCore'
import type {
  CustomMorphologyLayer,
  CustomMorphologyLayerLoadState,
} from '../morphology/customMorphologyLayers'
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
  readonly cellBoundaryVisibilityInputId: string
  readonly nucleusBoundaryVisibilityInputId: string
  readonly cellBoundaryOpacityInputId: string
  readonly coordinateUnitInputId: string
  readonly measurementModeInputId: string
  readonly measurementUnitInputId: string
  readonly customLayerLoadState: CustomMorphologyLayerLoadState
  readonly customLayers: readonly CustomMorphologyLayer[]
  readonly customLayerOpacities: Readonly<Record<string, number>>
  readonly loadEnabled: boolean
  readonly imageLayerOpacity: number
  readonly cellFillOpacity: number
  readonly showCellBoundaries: boolean
  readonly showNucleusBoundaries: boolean
  readonly nucleusBoundaryControlsVisible: boolean
  readonly cellBoundaryOpacity: number
  readonly coordinateUnit: ViewerCoordinateUnit
  readonly measurementEnabled: boolean
  readonly measurementUnit: ViewerCoordinateUnit
  readonly morphologyChannels: readonly MorphologyImageChannel[]
  readonly morphologyChannelSettings: readonly MorphologyChannelSetting[]
  readonly autoContrastChannelIds: readonly string[]
  readonly onImageLayerOpacityPercentChange: (percent: number) => void
  readonly onCustomLayerOpacityPercentChange: (imageUrl: string, percent: number) => void
  readonly onCellFillOpacityPercentChange: (percent: number) => void
  readonly onShowCellBoundariesChange: (enabled: boolean) => void
  readonly onShowNucleusBoundariesChange: (enabled: boolean) => void
  readonly onCellBoundaryOpacityPercentChange: (percent: number) => void
  readonly onCoordinateUnitChange: (unit: ViewerCoordinateUnit) => void
  readonly onMeasurementEnabledChange: (enabled: boolean) => void
  readonly onMeasurementUnitChange: (unit: ViewerCoordinateUnit) => void
  readonly onClearMeasurement: () => void
  readonly onAutoContrast: (channel: MorphologyImageChannel) => void
  readonly onLoadCustomLayer: (url: string) => Promise<boolean>
  readonly onRemoveCustomLayer: (layerId: string) => void
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
  cellBoundaryVisibilityInputId,
  nucleusBoundaryVisibilityInputId,
  cellBoundaryOpacityInputId,
  coordinateUnitInputId,
  measurementModeInputId,
  measurementUnitInputId,
  customLayerLoadState,
  customLayers,
  customLayerOpacities,
  loadEnabled,
  imageLayerOpacity,
  cellFillOpacity,
  showCellBoundaries,
  showNucleusBoundaries,
  nucleusBoundaryControlsVisible,
  cellBoundaryOpacity,
  coordinateUnit,
  measurementEnabled,
  measurementUnit,
  morphologyChannels,
  morphologyChannelSettings,
  autoContrastChannelIds,
  onImageLayerOpacityPercentChange,
  onCustomLayerOpacityPercentChange,
  onCellFillOpacityPercentChange,
  onShowCellBoundariesChange,
  onShowNucleusBoundariesChange,
  onCellBoundaryOpacityPercentChange,
  onCoordinateUnitChange,
  onMeasurementEnabledChange,
  onMeasurementUnitChange,
  onClearMeasurement,
  onAutoContrast,
  onLoadCustomLayer,
  onRemoveCustomLayer,
  onUpdateMorphologyChannel,
}: LayerHudPanelProps) {
  const customLayerUrlInputId = useId()
  const [customLayerUrl, setCustomLayerUrl] = useState('')
  const imageOpacityPercent = opacityToPercent(imageLayerOpacity)
  const cellFillOpacityPercent = opacityToPercent(cellFillOpacity)
  const cellBoundaryOpacityPercent = opacityToPercent(cellBoundaryOpacity)
  const trimmedCustomLayerUrl = customLayerUrl.trim()
  const isCustomLayerLoading = customLayerLoadState.status === 'loading'

  async function handleCustomLayerSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!loadEnabled || trimmedCustomLayerUrl.length === 0 || isCustomLayerLoading) {
      return
    }

    const loaded = await onLoadCustomLayer(trimmedCustomLayerUrl)

    if (loaded) {
      setCustomLayerUrl('')
    }
  }

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
        <div className="boundary-layer-toggles" aria-label="Boundary layers">
          <label htmlFor={cellBoundaryVisibilityInputId}>
            <input
              id={cellBoundaryVisibilityInputId}
              type="checkbox"
              checked={showCellBoundaries}
              title="Toggle cell boundary layer"
              onChange={(event) => {
                onShowCellBoundariesChange(event.currentTarget.checked)
              }}
            />
            <span>Cell boundaries</span>
          </label>
          {nucleusBoundaryControlsVisible ? (
            <label htmlFor={nucleusBoundaryVisibilityInputId}>
              <input
                id={nucleusBoundaryVisibilityInputId}
                type="checkbox"
                checked={showNucleusBoundaries}
                title="Toggle nucleus boundary layer"
                onChange={(event) => {
                  onShowNucleusBoundariesChange(event.currentTarget.checked)
                }}
              />
              <span>Nucleus boundaries</span>
            </label>
          ) : null}
        </div>
        <div className="layer-opacity-controls">
          <div className="layer-opacity-control">
            <div className="layer-opacity-header">
              <label htmlFor={imageOpacityInputId}>Dataset image opacity</label>
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
              title="Dataset image opacity"
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
        <form
          className="custom-layer-form"
          aria-label="Add custom image layer"
          onSubmit={(event) => {
            void handleCustomLayerSubmit(event)
          }}
        >
          <label htmlFor={customLayerUrlInputId}>Custom image URL</label>
          <div className="custom-layer-row">
            <input
              id={customLayerUrlInputId}
              type="url"
              name="custom-image-layer-url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://example.org/image.ome.tif"
              title="Custom image URL"
              value={customLayerUrl}
              disabled={!loadEnabled || isCustomLayerLoading}
              onChange={(event) => {
                setCustomLayerUrl(event.currentTarget.value)
              }}
            />
            <button
              type="submit"
              className="secondary-action"
              disabled={
                !loadEnabled || isCustomLayerLoading || trimmedCustomLayerUrl.length === 0
              }
              title="Load custom image layer"
            >
              {isCustomLayerLoading ? 'Loading...' : 'Load Layer'}
            </button>
          </div>
        </form>
        {customLayers.length > 0 ? (
          <ul className="custom-layer-list" aria-label="Custom image layers">
            {customLayers.map((layer) => {
              const customOpacityPercent = opacityToPercent(
                customLayerOpacities[layer.image.url] ?? 1,
              )
              const customOpacityInputId = `${customLayerUrlInputId}-${layer.id}-opacity`

              return (
                <li key={layer.id}>
                  <div className="custom-layer-summary">
                    <span>{layer.label}</span>
                    <small>{layer.channels.length.toLocaleString()} channels</small>
                    <button
                      type="button"
                      className="custom-layer-remove"
                      aria-label={`Remove ${layer.label}`}
                      title={`Remove ${layer.label}`}
                      onClick={() => {
                        onRemoveCustomLayer(layer.id)
                      }}
                    >
                      x
                    </button>
                  </div>
                  <div className="layer-opacity-control custom-layer-opacity-control">
                    <div className="layer-opacity-header">
                      <label htmlFor={customOpacityInputId}>{layer.label} opacity</label>
                      <span>{customOpacityPercent}%</span>
                    </div>
                    <input
                      id={customOpacityInputId}
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={customOpacityPercent}
                      aria-valuetext={`${customOpacityPercent}%`}
                      title={`${layer.label} opacity`}
                      onChange={(event) => {
                        onCustomLayerOpacityPercentChange(
                          layer.image.url,
                          event.currentTarget.valueAsNumber,
                        )
                      }}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        ) : null}
      </section>
    </div>
  )
}
