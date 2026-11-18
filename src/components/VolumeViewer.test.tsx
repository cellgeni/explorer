import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ImagePyramidVolumeLevel } from '../data/imagePyramid'
import { volumeTextureData } from '../data/imageVolume'
import type { VolumeLayer, VolumeLayerChannel } from '../rendering/volumeLayer'
import { VolumeViewer, type VolumeViewerProps } from './VolumeViewer'
import { fittedVolumeViewState, volumeStatus } from './volumeViewerModel'

const deckGlMock = vi.hoisted(() => ({ layers: [] as readonly unknown[] }))

vi.mock('@deck.gl/react', () => ({
  DeckGL: ({ layers = [] }: { readonly layers?: readonly unknown[] }) => {
    deckGlMock.layers = layers
    return <div data-testid="deckgl" />
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
