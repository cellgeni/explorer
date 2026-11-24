import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  Button,
  CameraIcon,
  Checkbox,
  NumberField,
  Popover,
  Segmented,
} from '../../components/ui'
import { formatBytes } from '../store-structure/storeStructureModel'
import type { ScreenshotModel } from './screenshotModel'
import type { ScreenshotBackground, ScreenshotInclude } from './screenshotOverlay'
import {
  DEFAULT_SCREENSHOT_DPI,
  DEFAULT_SCREENSHOT_SCALE,
  formatUnitsPerPixel,
  SCREENSHOT_ASK_BYTES,
  SCREENSHOT_SCALES,
  screenshotChannelRead,
  screenshotFrame,
  screenshotGrid,
  screenshotNotes,
  screenshotPixelSize,
  screenshotPrintSize,
  screenshotSizeLimitReason,
  screenshotUnitsPerPixel,
  type ScreenshotScale,
} from './screenshotPlan'
import type { ScreenshotSnapshot } from './screenshotRun'
import { screenshotProgressText } from './screenshotRunner'

const TITLE = 'Save the spatial view as a high-resolution PNG'

const BACKGROUNDS: readonly {
  readonly value: ScreenshotBackground
  readonly label: string
  readonly title: string
}[] = [
  { value: 'canvas', label: 'Canvas', title: 'Black, as on screen' },
  { value: 'white', label: 'White', title: 'White, with white boxes and dark text' },
  {
    value: 'transparent',
    label: 'Transparent',
    title: 'No background: the image and the cells over nothing',
  },
]

const INCLUDE: readonly {
  readonly key: keyof ScreenshotInclude
  readonly label: string
  readonly title: string
}[] = [
  {
    key: 'scaleBar',
    label: 'Scale bar',
    title: 'Draw the scale bar at the bottom right',
  },
  { key: 'legend', label: 'Legend', title: 'Draw the legend at the bottom left' },
  { key: 'axes', label: 'Axes', title: 'Draw the rulers along the top and left edges' },
  {
    key: 'selections',
    label: 'Selections',
    title: 'Draw the outlines of the saved and active selections',
  },
]

// Screenshot in the top bar (plan 27-D1), beside Share: a popover with the
// scale, what to include and the background, and Save PNG. A screenshot keeps
// running when the popover closes; the loading list shows it too.
export function ScreenshotButton({
  screenshot,
  iconOnly,
}: {
  readonly screenshot: ScreenshotModel
  readonly iconOnly: boolean
}) {
  return (
    <Popover
      title={TITLE}
      triggerLabel="Screenshot"
      align="end"
      disabled={!screenshot.available}
      trigger={
        <>
          <CameraIcon />
          {iconOnly ? null : <span className="shell-screenshot-label">Screenshot</span>}
        </>
      }
      triggerClassName={iconOnly ? 'ui-icon-button' : 'shell-screenshot-trigger'}
      className="shell-screenshot"
    >
      <ScreenshotPanel screenshot={screenshot} />
    </Popover>
  )
}

// Mounted while the popover is open, so the view is read when it opens.
function ScreenshotPanel({ screenshot }: { readonly screenshot: ScreenshotModel }) {
  const { runner } = screenshot
  const state = useSyncExternalStore(runner.subscribe, runner.getState)
  const [preview] = useState(() => runner.preview())
  const [scale, setScale] = useState<ScreenshotScale>(() =>
    preview === null ? DEFAULT_SCREENSHOT_SCALE : largestScaleWithin(preview),
  )
  const [dpi, setDpi] = useState(DEFAULT_SCREENSHOT_DPI)
  const [include, setInclude] = useState<ScreenshotInclude>(screenshot.include)
  const [background, setBackground] = useState<ScreenshotBackground>('canvas')
  const [askingToRead, setAskingToRead] = useState(false)
  const read = useImageReadEstimate(preview, scale)

  if (preview === null) {
    return (
      <p className="shell-screenshot-note">
        The view has not drawn yet. Open the popover again once it has.
      </p>
    )
  }

  const frame = screenshotFrame(preview.viewport)
  const size = screenshotPixelSize(frame, scale)
  const running = state.status === 'running'
  const notes = screenshotNotes({
    cells: preview.cells,
    expressionSampled: screenshot.expressionSampled,
    transcriptsAsDensity: screenshot.transcriptsAsDensity,
    loadingLabels: screenshot.loadingLabels,
  })
  const needsAsk = read.bytes !== null && read.bytes > SCREENSHOT_ASK_BYTES
  const save = () => {
    if (needsAsk && !askingToRead) {
      setAskingToRead(true)
      return
    }
    setAskingToRead(false)
    runner.start({ scale, dpi, include, background }, screenshot.file)
  }

  return (
    <>
      <div className="shell-screenshot-row">
        <span className="ui-field-label">Scale</span>
        <Segmented
          title="How many PNG pixels each pixel on screen becomes"
          label="Scale"
          value={String(scale) as `${ScreenshotScale}`}
          disabled={running}
          options={SCREENSHOT_SCALES.map((option) => {
            const reason = screenshotSizeLimitReason(screenshotPixelSize(frame, option))
            return {
              value: String(option) as `${ScreenshotScale}`,
              label: `${option.toString()}×`,
              title:
                reason === null
                  ? `${option.toString()} times the size on screen`
                  : `${reason}: too large to draw`,
              disabled: reason !== null,
            }
          })}
          onChange={(value) => {
            setScale(Number(value) as ScreenshotScale)
            setAskingToRead(false)
          }}
        />
      </div>
      <p className="shell-screenshot-size">
        {`${size.width.toLocaleString()} × ${size.height.toLocaleString()} px · ${formatUnitsPerPixel(
          screenshotUnitsPerPixel(preview.viewState.zoom, scale),
        )} ${preview.unitLabel} per pixel · ${screenshotPrintSize(size, dpi)}`}
      </p>
      <NumberField
        title="Dots per inch, written into the PNG; the pixels stay the same"
        label="DPI"
        value={dpi}
        min={30}
        max={2400}
        step={1}
        disabled={running}
        onChange={(value) => {
          setDpi(Math.round(value))
        }}
        className="ui-field--inline"
      />
      <fieldset className="shell-screenshot-include" disabled={running}>
        <legend className="ui-field-label">Include</legend>
        {INCLUDE.map((option) => (
          <Checkbox
            key={option.key}
            title={option.title}
            label={option.label}
            checked={include[option.key]}
            onChange={(checked) => {
              setInclude((current) => ({ ...current, [option.key]: checked }))
            }}
          />
        ))}
      </fieldset>
      <div className="shell-screenshot-row is-stacked">
        <span className="ui-field-label">Background</span>
        <Segmented
          title="What the PNG has under the image and the cells"
          label="Background"
          value={background}
          disabled={running}
          options={BACKGROUNDS}
          onChange={setBackground}
        />
      </div>
      {read.tiles === 0 ? null : (
        <p className="shell-screenshot-note">
          {`Reads ${read.tiles.toLocaleString()} image ${read.tiles === 1 ? 'tile' : 'tiles'}${
            read.bytes === null ? '' : ` (${formatBytes(read.bytes)})`
          }.`}
        </p>
      )}
      {notes.length === 0 ? null : (
        <ul className="shell-screenshot-notes">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
      <ScreenshotStatus
        state={state}
        onCancel={() => {
          runner.cancel()
        }}
        onRetry={() => {
          runner.retry()
        }}
      />
      {askingToRead && read.bytes !== null && !running ? (
        <p className="shell-screenshot-ask" role="alert">
          {`This reads ${formatBytes(read.bytes)} of image tiles, which can take minutes on a slow host.`}
        </p>
      ) : null}
      <div className="shell-screenshot-actions">
        {askingToRead && !running ? (
          <Button
            title="Keep the options and do not save"
            variant="ghost"
            onClick={() => {
              setAskingToRead(false)
            }}
          >
            Back
          </Button>
        ) : null}
        <Button
          title={`Save ${screenshot.file.fileName}`}
          variant="primary"
          disabled={running || screenshotSizeLimitReason(size) !== null}
          onClick={save}
        >
          {askingToRead && read.bytes !== null
            ? `Read ${formatBytes(read.bytes)} and save`
            : 'Save PNG'}
        </Button>
      </div>
    </>
  )
}

function ScreenshotStatus({
  state,
  onCancel,
  onRetry,
}: {
  readonly state: ReturnType<ScreenshotModel['runner']['getState']>
  readonly onCancel: () => void
  readonly onRetry: () => void
}) {
  if (state.status === 'running') {
    const progress = state.progress
    return (
      <div className="shell-screenshot-progress">
        <progress
          max={1}
          value={progress === null ? 0 : progress.done / Math.max(1, progress.total)}
          aria-label="Screenshot progress"
        />
        <span role="status">{screenshotProgressText(progress)}</span>
        <Button title="Stop the screenshot" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="shell-screenshot-error">
        <p role="alert">{`The screenshot failed. ${state.message}`}</p>
        {state.retryable ? (
          <Button
            title="Read the image again and save the screenshot"
            variant="ghost"
            onClick={onRetry}
          >
            Retry
          </Button>
        ) : null}
      </div>
    )
  }

  if (state.status === 'saved') {
    return (
      <p className="shell-screenshot-note" role="status">
        {`Saved ${state.fileName}.`}
      </p>
    )
  }

  return null
}

// D3: 2× to start, or the largest scale under the size limit below it.
function largestScaleWithin(preview: ScreenshotSnapshot): ScreenshotScale {
  const frame = screenshotFrame(preview.viewport)
  const fits = SCREENSHOT_SCALES.filter(
    (scale) =>
      scale <= DEFAULT_SCREENSHOT_SCALE &&
      screenshotSizeLimitReason(screenshotPixelSize(frame, scale)) === null,
  )
  return fits.at(-1) ?? 1
}

interface ImageReadEstimate {
  // Reads of every tile of the frame, a tile under two of them counted twice.
  readonly tiles: number
  // The bytes of the image's tiles, where the file's tile index says.
  readonly bytes: number | null
}

// D4: the tiles the screenshot reads at a scale, and their size from the
// TIFF tile index where there is one.
function useImageReadEstimate(
  preview: ScreenshotSnapshot | null,
  scale: ScreenshotScale,
): ImageReadEstimate {
  const channels = preview?.image.channels ?? []
  const reads =
    preview === null
      ? []
      : channels.map((channel) => {
          const frame = screenshotFrame(preview.viewport)
          return {
            loader: channel.loader,
            read: screenshotChannelRead(
              channel.loader,
              preview.viewState,
              frame,
              screenshotGrid(frame, scale),
              scale,
            ),
          }
        })
  const tiles = reads.reduce((count, { read }) => count + read.reads, 0)
  const [bytes, setBytes] = useState<{
    readonly scale: ScreenshotScale
    readonly bytes: number | null
  } | null>(null)

  useEffect(() => {
    if (preview === null) return
    const controller = new AbortController()
    const frame = screenshotFrame(preview.viewport)
    const grid = screenshotGrid(frame, scale)

    void Promise.all(
      preview.image.channels.map((channel) => {
        const read = screenshotChannelRead(
          channel.loader,
          preview.viewState,
          frame,
          grid,
          scale,
        )
        return (
          channel.loader.tileReadBytes?.(
            read.level,
            read.frameTiles,
            controller.signal,
          ) ?? Promise.resolve(null)
        )
      }),
    ).then(
      (sizes) => {
        if (controller.signal.aborted) return
        setBytes({
          scale,
          bytes:
            sizes.length === 0 || sizes.some((size) => size === null)
              ? null
              : sizes.reduce<number>((total, size) => total + (size ?? 0), 0),
        })
      },
      () => {
        if (!controller.signal.aborted) setBytes({ scale, bytes: null })
      },
    )

    return () => {
      controller.abort()
    }
  }, [preview, scale])

  return { tiles, bytes: bytes?.scale === scale ? bytes.bytes : null }
}
