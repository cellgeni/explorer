import { useId, useState, type FormEvent } from 'react'
import { opacityToPercent } from '../../rendering/layerOpacity'
import { MorphologyChannelControls } from '../morphology/MorphologyChannelControls'
import { MorphologyZPlaneControl } from '../morphology/MorphologyZPlaneControl'
import type { CustomImageLayersModel, ImageSectionModel } from './imageSectionModel'

export function ImageOpacityControl({ image }: { readonly image: ImageSectionModel }) {
  const inputId = useId()
  const opacityPercent = opacityToPercent(image.opacity)

  return (
    <div className="layer-opacity-control">
      <div className="layer-opacity-header">
        <label htmlFor={inputId}>Dataset image opacity</label>
        <span>{opacityPercent}%</span>
      </div>
      <input
        id={inputId}
        type="range"
        min="0"
        max="100"
        step="5"
        value={opacityPercent}
        aria-valuetext={`${opacityPercent}%`}
        title="Dataset image opacity"
        onChange={(event) => {
          image.onOpacityPercentChange(event.currentTarget.valueAsNumber)
        }}
      />
    </div>
  )
}

export function ImageZPlaneControl({ image }: { readonly image: ImageSectionModel }) {
  if (image.zStack === undefined) {
    return null
  }

  return (
    <MorphologyZPlaneControl
      zStack={image.zStack}
      requestedZPlane={image.requestedZPlane}
      onZPlaneChange={image.onZPlaneChange}
    />
  )
}

export function ImageChannelControls({ image }: { readonly image: ImageSectionModel }) {
  return (
    <MorphologyChannelControls
      channels={image.channels}
      settings={image.channelSettings}
      autoContrastChannelIds={image.autoContrastChannelIds}
      onAutoContrast={image.onAutoContrast}
      onUpdate={image.onUpdateChannel}
    />
  )
}

export function CustomImageLayers({
  layers: model,
}: {
  readonly layers: CustomImageLayersModel
}) {
  const customLayerUrlInputId = useId()
  const [customLayerUrl, setCustomLayerUrl] = useState('')
  const trimmedCustomLayerUrl = customLayerUrl.trim()
  const isCustomLayerLoading = model.loadState.status === 'loading'

  async function handleCustomLayerSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (
      !model.loadEnabled ||
      trimmedCustomLayerUrl.length === 0 ||
      isCustomLayerLoading
    ) {
      return
    }

    const loaded = await model.onLoad(trimmedCustomLayerUrl)

    if (loaded) {
      setCustomLayerUrl('')
    }
  }

  return (
    <>
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
            disabled={!model.loadEnabled || isCustomLayerLoading}
            onChange={(event) => {
              setCustomLayerUrl(event.currentTarget.value)
            }}
          />
          <button
            type="submit"
            className="secondary-action"
            disabled={
              !model.loadEnabled ||
              isCustomLayerLoading ||
              trimmedCustomLayerUrl.length === 0
            }
            title="Load custom image layer"
          >
            {isCustomLayerLoading ? 'Loading...' : 'Load Layer'}
          </button>
        </div>
      </form>
      {model.layers.length > 0 ? (
        <ul className="custom-layer-list" aria-label="Custom image layers">
          {model.layers.map((layer) => {
            const customOpacityPercent = opacityToPercent(
              model.opacities[layer.image.url] ?? 1,
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
                      model.onRemove(layer.id)
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
                      model.onOpacityPercentChange(
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
    </>
  )
}
