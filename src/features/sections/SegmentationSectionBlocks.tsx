import { useId, useState, type CSSProperties, type FormEvent } from 'react'
import { Select } from '../../components/ui'
import {
  SEGMENTATION_FILE_ACCEPT,
  SEGMENTATION_FORMAT_LABELS,
  type SegmentationCoordinates,
  type SegmentationFormat,
} from '../../datasets/segmentationSource'
import { opacityToPercent } from '../../rendering/layerOpacity'
import type {
  SegmentationSectionModel,
  SegmentationViewStatus,
} from './segmentationSectionModel'

const FORMAT_OPTIONS: readonly {
  readonly value: SegmentationFormat | ''
  readonly label: string
}[] = [
  { value: '', label: 'From the name' },
  ...(Object.entries(SEGMENTATION_FORMAT_LABELS) as [SegmentationFormat, string][]).map(
    ([value, label]) => ({ value, label }),
  ),
]
const COORDINATE_OPTIONS: readonly {
  readonly value: SegmentationCoordinates
  readonly label: string
}[] = [
  { value: 'pixels', label: 'Image pixels' },
  { value: 'micrometers', label: 'Micrometres' },
]

// The imported segmentation, or the form that imports one.
export function SegmentationPanel({
  segmentation,
}: {
  readonly segmentation: SegmentationSectionModel
}) {
  const { state } = segmentation

  return (
    <div className="analysis-section segmentation-section">
      {state.status === 'ready' ? (
        <SegmentationLayer segmentation={segmentation} />
      ) : (
        <SegmentationImportForm segmentation={segmentation} />
      )}
    </div>
  )
}

function SegmentationImportForm({
  segmentation,
}: {
  readonly segmentation: SegmentationSectionModel
}) {
  const urlInputId = useId()
  const fileInputId = useId()
  const [url, setUrl] = useState('')
  const [format, setFormat] = useState<SegmentationFormat | ''>('')
  const [coordinates, setCoordinates] = useState<SegmentationCoordinates>('pixels')
  const [inputError, setInputError] = useState<string | null>(null)
  const { state } = segmentation
  const loading = state.status === 'loading'
  const options = { format: format === '' ? null : format, coordinates }
  const labelFormat = format === 'label-tiff' || format === 'label-zarr'

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (loading || url.trim().length === 0) {
      return
    }

    setInputError(segmentation.onLoadUrl(url, options))
  }

  return (
    <>
      <form
        className="custom-layer-form segmentation-import-form"
        aria-label="Import segmentation"
        onSubmit={handleSubmit}
      >
        <label htmlFor={urlInputId}>Segmentation URL</label>
        <div className="custom-layer-row">
          <input
            id={urlInputId}
            type="url"
            name="segmentation-url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://example.org/cp_masks.tif"
            title="Segmentation URL"
            value={url}
            disabled={loading}
            onChange={(event) => {
              setUrl(event.currentTarget.value)
            }}
          />
          <button
            type="submit"
            className="secondary-action"
            disabled={loading || url.trim().length === 0}
            title="Load segmentation"
          >
            {loading ? 'Loading...' : 'Load'}
          </button>
        </div>
        <div className="segmentation-import-options">
          <Select<SegmentationFormat | ''>
            className="ui-field--inline"
            label="Format"
            title="Segmentation file format"
            value={format}
            disabled={loading}
            options={FORMAT_OPTIONS}
            onChange={setFormat}
          />
          <Select<SegmentationCoordinates>
            className="ui-field--inline"
            label="Coordinates"
            title="Units of polygon coordinates; label masks are placed over the image"
            value={coordinates}
            disabled={loading || labelFormat}
            options={COORDINATE_OPTIONS}
            onChange={setCoordinates}
          />
        </div>
        <div className="roi-action-row">
          <label
            className="secondary-file-action"
            htmlFor={fileInputId}
            title="Open a segmentation file"
          >
            Open File
          </label>
          <input
            id={fileInputId}
            className="visually-hidden-file"
            type="file"
            accept={SEGMENTATION_FILE_ACCEPT}
            disabled={loading}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ''

              if (file !== undefined) {
                setInputError(segmentation.onLoadFile(file, options))
              }
            }}
          />
        </div>
        <small className="segmentation-hint">
          A label mask (TIFF or OME-Zarr, 0 is background) or polygons (GeoJSON, WKT or
          CSV with a WKT column, Parquet). Outlines only, without a cell table.
        </small>
      </form>
      {loading ? (
        <p className="segmentation-status" role="status">
          Reading {state.source.url.slice(state.source.url.lastIndexOf('/') + 1)}
          {state.shapeCount === undefined
            ? '...'
            : `: ${state.shapeCount.toLocaleString()} outlines`}
        </p>
      ) : null}
      {inputError !== null || state.status === 'error' ? (
        <p className="annotation-import-error" role="alert">
          {inputError ??
            (state.status === 'error'
              ? `Could not read the segmentation. ${state.message}`
              : '')}
        </p>
      ) : null}
    </>
  )
}

function SegmentationLayer({
  segmentation,
}: {
  readonly segmentation: SegmentationSectionModel
}) {
  const opacityInputId = useId()
  const { state } = segmentation

  if (state.status !== 'ready') {
    return null
  }

  const imported = state.segmentation
  const opacityPercent = opacityToPercent(segmentation.opacity)
  const detail =
    imported.shapeCount === undefined
      ? imported.maskSize === undefined
        ? SEGMENTATION_FORMAT_LABELS[imported.source.format]
        : `${SEGMENTATION_FORMAT_LABELS[imported.source.format]} · ${imported.maskSize.width.toLocaleString()} × ${imported.maskSize.height.toLocaleString()}`
      : `${SEGMENTATION_FORMAT_LABELS[imported.source.format]} · ${imported.shapeCount.toLocaleString()}`

  return (
    <>
      <ul className="custom-layer-list" aria-label="Imported segmentation">
        <li>
          <div className="custom-layer-summary">
            <span title={imported.source.url}>{imported.name}</span>
            <small>{detail}</small>
            <button
              type="button"
              className="custom-layer-remove"
              aria-label={`Remove ${imported.name}`}
              title={`Remove ${imported.name}`}
              onClick={segmentation.onRemove}
            >
              x
            </button>
          </div>
        </li>
      </ul>
      {imported.warning === undefined ? null : (
        <p className="annotation-import-notice">{imported.warning}</p>
      )}
      <div className="segmentation-outline-row">
        <label
          className="annotation-color-picker"
          style={{ '--annotation-color': segmentation.outlineColor } as CSSProperties}
        >
          <input
            className="annotation-color-input"
            type="color"
            aria-label="Outline colour"
            title="Outline colour"
            value={segmentation.outlineColor}
            onChange={(event) => {
              segmentation.onOutlineColorChange(event.currentTarget.value)
            }}
          />
          <span className="annotation-color-swatch" aria-hidden="true" />
        </label>
        <div className="layer-opacity-control">
          <div className="layer-opacity-header">
            <label htmlFor={opacityInputId}>Outline opacity</label>
            <span>{opacityPercent}%</span>
          </div>
          <input
            id={opacityInputId}
            type="range"
            min="0"
            max="100"
            step="5"
            value={opacityPercent}
            aria-valuetext={`${opacityPercent}%`}
            title="Outline opacity"
            onChange={(event) => {
              segmentation.onOpacityPercentChange(event.currentTarget.valueAsNumber)
            }}
          />
        </div>
      </div>
      <SegmentationViewLine view={segmentation.view} show={segmentation.show} />
    </>
  )
}

function SegmentationViewLine({
  view,
  show,
}: {
  readonly view: SegmentationViewStatus
  readonly show: boolean
}) {
  if (!show) {
    return <p className="segmentation-status">Outlines are hidden.</p>
  }

  switch (view.kind) {
    case 'none':
      return null
    case 'loading':
      return (
        <p className="segmentation-status" role="status">
          Reading outlines in view...
        </p>
      )
    case 'drawn':
      return (
        <p className="segmentation-status" role="status">
          {view.count === 0
            ? 'No outlines in view.'
            : `${view.count.toLocaleString()} ${view.count === 1 ? 'outline' : 'outlines'} drawn.`}
        </p>
      )
    case 'zoom-in':
      return (
        <p className="segmentation-status" role="status">
          Zoom in to trace the mask&apos;s outlines.
        </p>
      )
    case 'over-limit':
      return (
        <p className="segmentation-status" role="status">
          Zoom in to draw outlines:{' '}
          {view.count === undefined
            ? 'too many in view'
            : `${view.estimated ? 'about ' : ''}${view.count.toLocaleString()} in view`}
          , over the boundary limit of {view.limit.toLocaleString()}.
        </p>
      )
    case 'error':
      return (
        <p className="annotation-import-error" role="alert">
          {view.message}
        </p>
      )
  }
}
