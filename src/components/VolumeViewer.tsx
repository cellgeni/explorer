import { OrbitView, type OrbitViewState } from '@deck.gl/core'
import { DeckGL } from '@deck.gl/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ImagePyramidVolumeLevel } from '../data/imagePyramid'
import { volumeExtent } from '../data/imageVolume'
import {
  VolumeLayer,
  type VolumeLayerChannel,
  type VolumeRenderMode,
} from '../rendering/volumeLayer'
import { Button, FitIcon, IconButton, Segmented, Slider } from './ui'
import { fittedVolumeViewState, volumeStatus } from './volumeViewerModel'

// The z-stack drawn in 3D (plan: 3D view), over the 2D view, which stays
// mounted underneath so leaving 3D returns to the same place.

export interface VolumeViewerProps {
  // The level read, or null when no level fits.
  readonly level: ImagePyramidVolumeLevel | null
  readonly levelCount: number
  readonly channels: readonly VolumeLayerChannel[]
  // Channels turned on in the image controls; some may still be loading.
  readonly enabledChannelCount: number
  readonly progress: { readonly planesRead: number; readonly planesTotal: number } | null
  readonly error: string | null
  readonly onClose: () => void
}

const VOLUME_VIEW = new OrbitView({ id: 'volume', orbitAxis: 'Y', fovy: 50 })
const DEFAULT_SIZE = { width: 800, height: 600 }
// Depth scale slider: powers of two from a quarter to 16 times.
const MIN_DEPTH_SCALE_LOG2 = -2
const MAX_DEPTH_SCALE_LOG2 = 4
const RENDER_MODE_OPTIONS = [
  {
    value: 'mip',
    label: 'Max intensity',
    title: 'Show the brightest value along each line of sight',
  },
  {
    value: 'translucent',
    label: 'Translucent',
    title: 'Show bright structures as translucent, nearer ones in front',
  },
] as const

export function VolumeViewer({
  level,
  levelCount,
  channels,
  enabledChannelCount,
  progress,
  error,
  onClose,
}: VolumeViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{
    readonly width: number
    readonly height: number
  } | null>(null)
  const [renderMode, setRenderMode] = useState<VolumeRenderMode>('mip')
  const [depthScaleLog2, setDepthScaleLog2] = useState(0)
  const [densityPercent, setDensityPercent] = useState(50)
  const [viewState, setViewState] = useState<OrbitViewState | null>(null)
  const depthScale = 2 ** depthScaleLog2
  const extent = useMemo(
    () => (level === null ? null : volumeExtent(level, depthScale)),
    [depthScale, level],
  )
  const shownViewState =
    viewState ?? fittedVolumeViewState(extent ?? [1, 1, 1], size ?? DEFAULT_SIZE)
  const layers = useMemo(
    () =>
      extent === null || channels.length === 0
        ? []
        : [
            new VolumeLayer({
              id: 'volume',
              channels,
              extent,
              renderMode,
              density: densityPercent / 100,
            }),
          ],
    [channels, densityPercent, extent, renderMode],
  )

  useEffect(() => {
    const element = containerRef.current

    if (element === null || typeof ResizeObserver === 'undefined') {
      return
    }

    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) {
        setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
      }
    })

    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [])

  const status = volumeStatus({
    level,
    levelCount,
    channels,
    enabledChannelCount,
    progress,
  })

  return (
    <section className="volume-viewer" aria-label="3D view" ref={containerRef}>
      <div className="volume-viewer-canvas">
        <DeckGL
          views={VOLUME_VIEW}
          viewState={shownViewState}
          onViewStateChange={({ viewState: next }) => {
            setViewState(next as OrbitViewState)
          }}
          controller
          layers={layers}
        />
      </div>
      <div className="volume-viewer-toolbar" role="group" aria-label="3D view settings">
        <Segmented
          title="How the volume is drawn"
          label="Rendering"
          value={renderMode}
          options={RENDER_MODE_OPTIONS}
          onChange={setRenderMode}
        />
        <Slider
          className="volume-viewer-depth"
          title="Stretch or flatten the volume along z"
          label="Depth"
          min={MIN_DEPTH_SCALE_LOG2}
          max={MAX_DEPTH_SCALE_LOG2}
          step={0.25}
          value={depthScaleLog2}
          formatValue={(value) => formatDepthScale(2 ** value)}
          onChange={setDepthScaleLog2}
        />
        {renderMode === 'translucent' ? (
          <Slider
            title="How much bright structures hide what is behind them"
            label="Opacity"
            min={0}
            max={100}
            step={5}
            value={densityPercent}
            formatValue={(value) => `${value.toString()}%`}
            onChange={setDensityPercent}
          />
        ) : null}
        <div className="volume-viewer-actions">
          <IconButton
            title="Reset the 3D view"
            icon={<FitIcon />}
            onClick={() => {
              setViewState(null)
            }}
          />
          <Button title="Return to the 2D view" onClick={onClose}>
            2D View
          </Button>
        </div>
      </div>
      <div className="volume-viewer-status">
        {status === null ? null : (
          <p className="viewport-message" aria-live="polite">
            {status}
          </p>
        )}
        {error === null ? null : (
          <p className="viewport-message viewport-message-error" aria-live="assertive">
            {error}
          </p>
        )}
      </div>
      <p className="volume-viewer-hint">
        Drag to rotate · Shift-drag to pan · Scroll to zoom
      </p>
    </section>
  )
}

function formatDepthScale(scale: number): string {
  return `×${Number(scale.toFixed(2)).toString()}`
}
