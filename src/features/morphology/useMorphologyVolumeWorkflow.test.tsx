import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type {
  ImagePyramidLoader,
  ImagePyramidVolume,
  ImagePyramidVolumeLevel,
} from '../../data/imagePyramid'
import type { MorphologyImage } from '../../data/morphologyImage'
import type { MorphologyChannelSetting } from './morphologyChannels'
import {
  morphologyVolumeLevels,
  useMorphologyVolumeWorkflow,
} from './useMorphologyVolumeWorkflow'

const LEVELS: readonly ImagePyramidVolumeLevel[] = [
  { level: 0, width: 4, height: 2, depth: 3, voxelSize: { x: 1, y: 1 } },
]

interface Read {
  readonly channelId: string
  readonly level: number
  readonly signal: AbortSignal | undefined
  readonly onProgress: ((planesRead: number) => void) | undefined
  readonly resolve: (volume: ImagePyramidVolume) => void
  readonly reject: (error: unknown) => void
}

function volumeImage(
  url: string,
  reads: Read[],
  channelIds: readonly string[] = ['A', 'B'],
): MorphologyImage {
  const loader = (channelId: string) =>
    ({
      url,
      volumeLevels: () => LEVELS,
      loadVolume: (
        level: number,
        signal?: AbortSignal,
        onProgress?: (planesRead: number) => void,
      ) =>
        new Promise<ImagePyramidVolume>((resolve, reject) => {
          reads.push({ channelId, level, signal, onProgress, resolve, reject })
        }),
    }) as unknown as ImagePyramidLoader
  const channels = channelIds.map((id, index) => ({
    info: {
      id,
      index,
      name: `Channel ${id}`,
      color: [255, 255, 255] as const,
      contrast: { min: 0, max: 255 },
    },
    loader: loader(id),
  }))

  return {
    url,
    loader: channels[0]?.loader ?? loader('A'),
    channels: channels.map((channel) => channel.info),
    channelLoaders: channels,
  }
}

function settings(
  enabledIds: readonly string[],
  channelIds: readonly string[] = ['A', 'B'],
): readonly MorphologyChannelSetting[] {
  return channelIds.map((id) => ({
    id,
    enabled: enabledIds.includes(id),
    color: id === 'A' ? [255, 0, 0] : [0, 255, 0],
    contrastMin: 10,
    contrastMax: 200,
  }))
}

function volume(value: number): ImagePyramidVolume {
  return { data: new Uint8Array(24).fill(value), width: 4, height: 2, depth: 3 }
}

function renderWorkflow(initial: {
  image: MorphologyImage | null
  settings: readonly MorphologyChannelSetting[]
}) {
  return renderHook((props) => useMorphologyVolumeWorkflow(props), {
    initialProps: initial,
  })
}

describe('useMorphologyVolumeWorkflow', () => {
  it('reads the enabled channels and reports planes read', async () => {
    const reads: Read[] = []
    const image = volumeImage('https://example.test/stack.ome.zarr', reads)
    const { result } = renderWorkflow({ image, settings: settings(['A']) })

    expect(reads.map((read) => [read.channelId, read.level])).toEqual([['A', 0]])
    expect(result.current).toMatchObject({
      level: LEVELS[0],
      levelCount: 1,
      channels: [],
      enabledChannelCount: 1,
      progress: { planesRead: 0, planesTotal: 3 },
      error: null,
    })

    act(() => {
      reads[0]?.onProgress?.(2)
    })
    expect(result.current.progress).toEqual({ planesRead: 2, planesTotal: 3 })

    await act(async () => {
      reads[0]?.resolve(volume(7))
      await Promise.resolve()
    })

    expect(result.current.progress).toBeNull()
    expect(result.current.channels).toHaveLength(1)
    expect(result.current.channels[0]).toMatchObject({
      id: 'A',
      color: [255, 0, 0],
      contrastMin: 10,
      contrastMax: 200,
      texture: { format: 'r8unorm', width: 4, height: 2, depth: 3 },
    })
  })

  it('reads the first six enabled channels and counts them all', () => {
    const reads: Read[] = []
    const ids = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
    const { result } = renderWorkflow({
      image: volumeImage('https://example.test/stack.ome.zarr', reads, ids),
      settings: settings(['A', 'C', 'D', 'E', 'F', 'G', 'H'], ids),
    })

    expect(reads.map((read) => read.channelId)).toEqual(['A', 'C', 'D', 'E', 'F', 'G'])
    expect(result.current).toMatchObject({
      enabledChannelCount: 7,
      progress: { planesRead: 0, planesTotal: 18 },
    })
  })

  it('keeps volumes across z planes and reads a channel turned on', async () => {
    const reads: Read[] = []
    const { result, rerender } = renderWorkflow({
      image: volumeImage('https://example.test/stack.ome.zarr', reads),
      settings: settings(['A']),
    })

    await act(async () => {
      reads[0]?.resolve(volume(1))
      await Promise.resolve()
    })
    rerender({
      image: volumeImage('https://example.test/stack.ome.zarr#z=2', reads),
      settings: settings(['A', 'B']),
    })

    expect(reads.map((read) => read.channelId)).toEqual(['A', 'B'])
    expect(result.current.channels.map((channel) => channel.id)).toEqual(['A'])
    expect(result.current.progress).toEqual({ planesRead: 0, planesTotal: 3 })
  })

  it('stops the read of a channel turned off', () => {
    const reads: Read[] = []
    const image = volumeImage('https://example.test/stack.ome.zarr', reads)
    const { result, rerender } = renderWorkflow({ image, settings: settings(['A']) })

    rerender({ image, settings: settings([]) })

    expect(reads[0]?.signal?.aborted).toBe(true)
    expect(result.current).toMatchObject({ enabledChannelCount: 0, progress: null })
  })

  it('keeps one read of a channel turned off and on while the first settles', async () => {
    const reads: Read[] = []
    const image = volumeImage('https://example.test/stack.ome.zarr', reads)
    const { rerender } = renderWorkflow({ image, settings: settings(['A']) })

    rerender({ image, settings: settings([]) })
    rerender({ image, settings: settings(['A']) })
    // The stopped read settles while its replacement is still reading.
    await act(async () => {
      reads[0]?.reject(new DOMException('Aborted', 'AbortError'))
      await Promise.resolve()
    })
    rerender({ image, settings: settings(['A']) })

    expect(reads.map((read) => read.signal?.aborted)).toEqual([true, false])
  })

  it('reports a failed read without reading it again', async () => {
    const reads: Read[] = []
    const image = volumeImage('https://example.test/stack.ome.zarr', reads)
    const { result, rerender } = renderWorkflow({ image, settings: settings(['A']) })

    await act(async () => {
      reads[0]?.reject(new Error('403 Forbidden'))
      await Promise.resolve()
    })
    rerender({ image, settings: settings(['A']) })

    expect(result.current.error).toBe('Could not read Channel A in 3D: 403 Forbidden')
    expect(result.current.progress).toBeNull()
    expect(reads).toHaveLength(1)
  })

  it('drops the volumes of another image', async () => {
    const reads: Read[] = []
    const { result, rerender } = renderWorkflow({
      image: volumeImage('https://example.test/stack.ome.zarr', reads),
      settings: settings(['A', 'B']),
    })

    await act(async () => {
      reads[0]?.resolve(volume(1))
      await Promise.resolve()
    })
    rerender({
      image: volumeImage('https://example.test/other.ome.zarr', reads),
      settings: settings(['A', 'B']),
    })

    expect(result.current.channels).toEqual([])
    expect(reads.map((read) => read.signal?.aborted)).toEqual([false, true, false, false])

    // The first image's channel B arrives late and is not shown.
    await act(async () => {
      reads[1]?.resolve(volume(2))
      reads[2]?.resolve(volume(3))
      await Promise.resolve()
    })
    expect(result.current.channels.map((channel) => channel.id)).toEqual(['A'])
  })

  it('stops and ignores the reads of earlier images that settle late', async () => {
    const reads: Read[] = []
    const { result, rerender } = renderWorkflow({
      image: volumeImage('https://example.test/first.ome.zarr', reads),
      settings: settings(['A']),
    })

    rerender({
      image: volumeImage('https://example.test/second.ome.zarr', reads),
      settings: settings(['A']),
    })

    // The first image's stopped read rejects after the second image's starts.
    await act(async () => {
      reads[0]?.reject(new DOMException('The read was stopped', 'AbortError'))
      await Promise.resolve()
    })
    rerender({
      image: volumeImage('https://example.test/third.ome.zarr', reads),
      settings: settings(['A']),
    })

    expect(reads.map((read) => read.signal?.aborted)).toEqual([true, true, false])

    // The second image's read settles after the third image's.
    await act(async () => {
      reads[2]?.resolve(volume(3))
      await Promise.resolve()
    })
    await act(async () => {
      reads[1]?.onProgress?.(2)
      reads[1]?.resolve(volume(2))
      await Promise.resolve()
    })

    expect(reads).toHaveLength(3)
    expect(result.current).toMatchObject({ progress: null, error: null })
    expect(result.current.channels.map((channel) => channel.texture.data[0])).toEqual([3])
  })

  it('stops reading when it unmounts', () => {
    const reads: Read[] = []
    const { unmount } = renderWorkflow({
      image: volumeImage('https://example.test/stack.ome.zarr', reads),
      settings: settings(['A', 'B']),
    })

    unmount()

    expect(reads.map((read) => read.signal?.aborted)).toEqual([true, true])
  })
})

describe('morphologyVolumeLevels', () => {
  it('lists levels only for loaders that read volumes', () => {
    const image = volumeImage('https://example.test/stack.ome.zarr', [])

    expect(morphologyVolumeLevels(image)).toBe(LEVELS)
    expect(morphologyVolumeLevels(null)).toEqual([])
    expect(
      morphologyVolumeLevels({
        ...image,
        loader: { url: image.url } as unknown as ImagePyramidLoader,
      }),
    ).toEqual([])
  })
})
