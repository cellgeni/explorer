import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { OrbitViewState } from '@deck.gl/core'
import { describe, expect, it, vi } from 'vitest'
import type { ImagePyramidVolumeLevel } from '../data/imagePyramid'
import { volumeTextureData } from '../data/imageVolume'
import type { VolumeLayer, VolumeLayerChannel } from '../rendering/volumeLayer'
import { VolumeViewer, type VolumeViewerProps } from './VolumeViewer'
import { fittedVolumeViewState, volumeStatus } from './volumeViewerModel'

interface DeckGlMockProps {
  readonly layers?: readonly unknown[]
  readonly viewState?: OrbitViewState
  readonly onViewStateChange?: (change: { readonly viewState: OrbitViewState }) => void
  readonly onLoad?: () => void
}

const deckGlMock = vi.hoisted(() => ({
  layers: [] as readonly unknown[],
  props: {} as DeckGlMockProps,
}))

// deck.gl's event root takes keyboard focus, as mjolnir.js sets it up.
vi.mock('@deck.gl/react', () => ({
  DeckGL: (props: DeckGlMockProps) => {
    deckGlMock.layers = props.layers ?? []
    deckGlMock.props = props
    return <div className="deck-events-root" data-testid="deckgl" tabIndex={0} />
  },
}))

const LEVEL: ImagePyramidVolumeLevel = {
  level: 1,
  width: 256,
  height: 128,
  depth: 64,
  voxelSize: { x: 2, y: 2 },
}

const CHANNEL: VolumeLayerChannel = {
  texture: volumeTextureData({
    data: new Uint8Array(8),
    width: 2,
    height: 2,
    depth: 2,
  }),
  color: [255, 0, 0],
  contrastMin: 0,
  contrastMax: 255,
}

function renderViewer(overrides: Partial<VolumeViewerProps> = {}) {
  const onClose = vi.fn()

  render(
    <VolumeViewer
      level={LEVEL}
      levelCount={3}
      channels={[CHANNEL]}
      enabledChannelCount={1}
      progress={null}
      error={null}
      onClose={onClose}
      {...overrides}
    />,
  )

  return { onClose, view: screen.getByRole('region', { name: '3D view' }) }
}

function volumeLayer(): VolumeLayer {
  const layer = deckGlMock.layers[0] as VolumeLayer | undefined

  if (layer === undefined) {
    throw new Error('No volume layer was drawn.')
  }

  return layer
}

describe('VolumeViewer', () => {
  it('draws the channels and says which level it shows', () => {
    const { view } = renderViewer()

    expect(volumeLayer().props).toMatchObject({
      channels: [CHANNEL],
      extent: [512, 256, 128],
      renderMode: 'mip',
    })
    expect(within(view).getByText('Level 2 of 3, 256 × 128 × 64 voxels')).toBeTruthy()
  })

  it('switches to translucent rendering, with an opacity control', () => {
    const { view } = renderViewer()

    expect(within(view).queryByRole('slider', { name: 'Opacity' })).toBeNull()
    fireEvent.click(within(view).getByRole('button', { name: 'Translucent' }))

    fireEvent.change(within(view).getByRole('slider', { name: 'Opacity' }), {
      target: { value: '80' },
    })
    expect(volumeLayer().props).toMatchObject({ renderMode: 'translucent', density: 0.8 })
  })

  it('stretches depth', () => {
    const { view } = renderViewer()

    fireEvent.change(within(view).getByRole('slider', { name: 'Depth' }), {
      target: { value: '2' },
    })

    expect(volumeLayer().props.extent).toEqual([512, 256, 512])
    expect(within(view).getByText('×4')).toBeTruthy()
  })

  it('moves from the keyboard on its named canvas, and Home resets it (EXP-319)', () => {
    const { view } = renderViewer()
    const canvas = within(view).getByRole('img', { name: '3D view canvas area' })

    expect(canvas).toHaveAttribute('tabindex', '0')
    expect(canvas).toHaveAccessibleDescription(
      'Shift+arrows rotate · Arrows pan · + and − zoom · Home resets',
    )
    // deck.gl's own root, which takes the keys the canvas hands it, leaves
    // the Tab order once loaded.
    act(() => {
      deckGlMock.props.onLoad?.()
    })
    expect(within(view).getByTestId('deckgl')).toHaveAttribute('tabindex', '-1')

    const fitted = deckGlMock.props.viewState
    act(() => {
      deckGlMock.props.onViewStateChange?.({
        viewState: { ...fitted!, rotationOrbit: 90 },
      })
    })
    expect(deckGlMock.props.viewState?.rotationOrbit).toBe(90)
    fireEvent.keyDown(canvas, { key: 'Home', code: 'Home' })
    expect(deckGlMock.props.viewState).toEqual(fitted)
  })

  it('returns to 2D', () => {
    const { onClose, view } = renderViewer()

    fireEvent.click(within(view).getByRole('button', { name: '2D View' }))

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('shows read errors and draws nothing without channels', () => {
    const { view } = renderViewer({
      channels: [],
      error: 'Could not read DAPI in 3D: 403 Forbidden',
    })

    expect(deckGlMock.layers).toEqual([])
    expect(
      within(view).getByText('Could not read DAPI in 3D: 403 Forbidden'),
    ).toBeTruthy()
  })
})

describe('volumeStatus', () => {
  const base = {
    level: LEVEL,
    levelCount: 1,
    channels: [CHANNEL],
    enabledChannelCount: 1,
    progress: null,
  }

  it('says why nothing is drawn', () => {
    expect(volumeStatus({ ...base, level: null })).toBe(
      'This image is too large to show in 3D.',
    )
    expect(volumeStatus({ ...base, channels: [], enabledChannelCount: 0 })).toBe(
      'Turn on a channel to show it in 3D.',
    )
  })

  it('counts planes read', () => {
    expect(
      volumeStatus({
        ...base,
        channels: [],
        progress: { planesRead: 12, planesTotal: 128 },
      }),
    ).toBe('Reading 256 × 128 × 64 voxels: 12 of 128 planes')
  })

  it('says which channels it draws when more than six are on', () => {
    const nine = { ...base, enabledChannelCount: 9 }

    expect(volumeStatus(nine)).toBe(
      '256 × 128 × 64 voxels. Showing the first 6 of 9 enabled channels',
    )
    expect(
      volumeStatus({ ...nine, progress: { planesRead: 12, planesTotal: 384 } }),
    ).toBe(
      'Reading 256 × 128 × 64 voxels: 12 of 384 planes. Showing the first 6 of 9 enabled channels',
    )
    expect(volumeStatus({ ...nine, channels: [] })).toBe(
      'Showing the first 6 of 9 enabled channels',
    )
    expect(volumeStatus({ ...base, enabledChannelCount: 6 })).toBe(
      '256 × 128 × 64 voxels',
    )
  })
})

describe('fittedVolumeViewState', () => {
  it('zooms so the volume fits at any angle', () => {
    // A 300 × 400 × 1200 box has a 1300 diagonal; 0.9 × 650 px fits it at
    // 0.45 px per unit.
    expect(fittedVolumeViewState([300, 400, 1200], { width: 650, height: 900 })).toEqual(
      expect.objectContaining({ target: [0, 0, 0], zoom: Math.log2(0.45) }),
    )
  })
})
