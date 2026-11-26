import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadMorphologyImage } from '../data/morphologyImage'
import { buildIfdFirstTiff, stubRangeFetchInRounds } from '../test/tiffFixtures'
import { clearOpenTiffFiles, openTiff } from './loader'
import type { TestTiffPyramidImage } from '../test/tiffFixtures'

afterEach(() => {
  clearOpenTiffFiles()
  vi.unstubAllGlobals()
})

// Each round trip to a host costs its latency (300 ms in the optimization
// pass's S7), so opening an image should take as few as the file allows.
describe('round trips to open a TIFF', () => {
  it('opens a pyramid stored as SubIFDs in two', async () => {
    const url = 'https://example.test/images/stain.ome.tif'
    const { fetcher, roundsUntil } = stubRangeFetchInRounds({
      [url]: buildIfdFirstTiff([pyramid(omeXml(['stain.ome.tif']))]).bytes,
    })
    const opened = openTiff(url)

    // The header with the first IFD and its tag values, then the SubIFDs,
    // which are stored after level 0's 128 kB of tiles.
    expect(await roundsUntil(opened)).toBe(2)

    const loader = await opened
    // The sidecar lookup, the header, and one read per SubIFD.
    expect(tiffReads(fetcher, url)).toHaveLength(4)
    expect(loader.numLevels).toBe(3)
    expect(loader.tilesForLevel(0)).toHaveLength(16)
    expect(loader.tilesForLevel(2)).toHaveLength(1)

    const tile = loader.fetchTileBytes(1, 1, 1)
    await roundsUntil(tile)
    const bytes = await tile
    expect((bytes[0] ?? 0) + ((bytes[1] ?? 0) << 8)).toBe(1003)
  })

  it('reads the SubIFDs with a description stored at the end of the file', async () => {
    const url = 'https://example.test/images/stain.ome.tif'
    const file = buildIfdFirstTiff([pyramid(omeXml(['stain.ome.tif']))], {
      descriptionsAtEnd: true,
    }).bytes
    const { fetcher, roundsUntil } = stubRangeFetchInRounds({ [url]: file })
    const opened = openTiff(url)

    // The header, then the description and the SubIFDs together.
    expect(await roundsUntil(opened)).toBe(2)
    expect((await opened).numLevels).toBe(3)
    expect(tiffReads(fetcher, url)).toHaveLength(5)
  })

  it('reads no SubIFDs when a sidecar gives the tiles', async () => {
    const url = 'https://example.test/images/stain.ome.tif'
    const { fetcher, roundsUntil } = stubRangeFetchInRounds({
      [url]: buildIfdFirstTiff([pyramid(omeXml(['stain.ome.tif']))]).bytes,
      [`${url}.zchunkstore`]: new TextEncoder().encode(JSON.stringify(sidecar())),
    })
    const opened = openTiff(url)

    // The sidecar with the header.
    expect(await roundsUntil(opened)).toBe(1)
    expect((await opened).numLevels).toBe(1)
    expect(tiffReads(fetcher, url).map(([, init]) => rangeHeader(init))).toEqual([
      null,
      'bytes=0-65535',
    ])
  })

  it.each([
    ['a Xenium focus image', 'https://example.test/xenium/morphology_focus/'],
    ['another multi-file OME-TIFF', 'https://example.test/run/'],
  ])("opens %s's other files while the first opens", async (_name, folder) => {
    const names = ['ch0000_dapi.ome.tif', 'ch0001_boundary.ome.tif', 'ch0002_rna.ome.tif']
    const { roundsUntil } = stubRangeFetchInRounds(channelFiles(folder, names))
    const opened = loadMorphologyImage(folder, { candidates: [names[0] ?? ''] })

    // The first file's header; its SubIFDs with the other files' headers;
    // their SubIFDs. The sidecar lookups go with the headers.
    expect(await roundsUntil(opened)).toBe(3)

    const image = await opened
    expect(image.channelLoaders.map((channel) => channel.info.name)).toEqual([
      'C0',
      'C1',
      'C2',
    ])
    expect(new Set(image.channelLoaders.map((channel) => channel.loader)).size).toBe(3)
  })
})

// 256 × 256 pixels in 64-pixel tiles, with levels of 128 and 64 as SubIFDs.
// Tile N of level L holds 1000 L + N.
function pyramid(description: string): TestTiffPyramidImage {
  const level = (index: number, size: number): TestTiffPyramidImage => ({
    width: size,
    height: size,
    tile: 64,
    value: (tile) => 1000 * index + tile,
  })

  return {
    ...level(0, 256),
    description,
    subIfds: [level(1, 128), level(2, 64)],
  }
}

// One channel per file, as Xenium's morphology_focus files name them.
function omeXml(fileNames: readonly string[]): string {
  const channels = fileNames
    .map(
      (_, index) =>
        `<Channel ID="Channel:${index.toString()}" Name="C${index.toString()}" SamplesPerPixel="1"/>`,
    )
    .join('')
  const tiffData = fileNames
    .map(
      (fileName, index) =>
        `<TiffData FirstC="${index.toString()}" PlaneCount="1"><UUID FileName="${fileName}">urn:uuid:${index.toString()}</UUID></TiffData>`,
    )
    .join('')

  return `<?xml version="1.0" encoding="UTF-8"?>
<OME xmlns="http://www.openmicroscopy.org/Schemas/OME/2016-06">
  <Image ID="Image:0">
    <Pixels ID="Pixels:0" DimensionOrder="XYZCT" Type="uint16" SizeX="256" SizeY="256" SizeZ="1" SizeC="${fileNames.length.toString()}" SizeT="1" PhysicalSizeX="0.5" PhysicalSizeY="0.5">
      ${channels}${tiffData}
    </Pixels>
  </Image>
</OME>`
}

function channelFiles(
  folder: string,
  names: readonly string[],
): Record<string, Uint8Array> {
  return Object.fromEntries(
    names.map((name) => [
      `${folder}${name}`,
      buildIfdFirstTiff([pyramid(omeXml(names))]).bytes,
    ]),
  )
}

// A Zarr chunk store manifest for level 0 alone.
function sidecar(): unknown {
  const chunks = Object.fromEntries(
    Array.from({ length: 16 }, (_, tile) => [
      `0/c/0/${Math.floor(tile / 4).toString()}/${(tile % 4).toString()}`,
      { offset: 100_000 + tile * 8192, size: 8192 },
    ]),
  )

  return {
    'zarr.json': {
      zarr_format: 3,
      node_type: 'group',
      attributes: { multiscales: [{ datasets: [{ path: '0' }] }] },
    },
    '0/zarr.json': {
      zarr_format: 3,
      node_type: 'array',
      shape: [1, 256, 256],
      chunk_grid: { configuration: { chunk_shape: [1, 64, 64] } },
    },
    ...chunks,
  }
}

function rangeHeader(init: unknown): string | null {
  return new Headers((init as RequestInit | undefined)?.headers).get('Range')
}

function tiffReads(fetcher: ReturnType<typeof vi.fn>, url: string) {
  return fetcher.mock.calls.filter(([input]) => String(input).startsWith(url))
}
