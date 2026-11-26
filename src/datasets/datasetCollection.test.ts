import { describe, expect, it, vi } from 'vitest'
import {
  collectionEntryFor,
  collectionGroups,
  DatasetCollectionError,
  fetchDatasetCollection,
  MAX_COLLECTION_DATASETS,
  parseDatasetCollection,
} from './datasetCollection'
import { DatasetManifestError, parseDatasetManifest } from './datasetManifest'

const COLLECTION_URL = 'https://example.test/studies/injury/collection.json'

function parse(json: unknown) {
  return parseDatasetCollection(json, COLLECTION_URL)
}

function parseError(json: unknown): string {
  try {
    parse(json)
  } catch (error) {
    expect(error).toBeInstanceOf(DatasetCollectionError)
    return (error as Error).message
  }

  throw new Error('Expected the collection to be rejected.')
}

describe('parseDatasetCollection', () => {
  it('resolves dataset paths against the collection folder', () => {
    const collection = parse({
      version: 1,
      name: 'Injury time course',
      datasets: [
        { dataset: 'sham-a/explorer.json', name: 'Sham A', group: 'Sham' },
        { dataset: './sham-b.zarr/', group: 'Sham' },
        { dataset: 'https://data.example.test/1dpi-a.h5ad', group: '1 dpi' },
      ],
    })

    expect(collection).toEqual({
      url: COLLECTION_URL,
      name: 'Injury time course',
      datasets: [
        {
          path: 'sham-a/explorer.json',
          url: 'https://example.test/studies/injury/sham-a/explorer.json',
          name: 'Sham A',
          group: 'Sham',
        },
        {
          path: 'sham-b.zarr',
          url: 'https://example.test/studies/injury/sham-b.zarr',
          group: 'Sham',
        },
        {
          path: 'https://data.example.test/1dpi-a.h5ad',
          url: 'https://data.example.test/1dpi-a.h5ad',
          group: '1 dpi',
        },
      ],
    })
  })

  it('resolves dataset paths against root', () => {
    const collection = parse({
      version: 1,
      root: 'https://bucket.example.test/SPCOX/',
      datasets: [{ dataset: 'SPCOX-Sham-A-anndata.zarr' }],
    })

    expect(collection.datasets[0]?.url).toBe(
      'https://bucket.example.test/SPCOX/SPCOX-Sham-A-anndata.zarr',
    )
  })

  it('keeps the source and the cross-dataset defaults', () => {
    const collection = parse({
      version: 1,
      description: 'Sections across six time points.',
      source: { repository: 'BioImage Archive', url: 'https://example.test/S-1' },
      datasets: [{ dataset: 'a.h5ad' }],
      defaults: {
        genes: [' Aqp4 '],
        colorCellsBy: 'gene-expression',
        geneColorScale: 'plasma',
        geneRange: [0, 25],
        cellPointScale: 12,
      },
    })

    expect(collection.description).toBe('Sections across six time points.')
    expect(collection.source).toEqual({
      repository: 'BioImage Archive',
      url: 'https://example.test/S-1',
    })
    expect(collection.defaults).toEqual({
      genes: ['Aqp4'],
      colorCellsBy: 'gene-expression',
      geneColorScale: 'plasma',
      geneRange: [0, 25],
      cellPointScale: 12,
    })
  })

  it('rejects files that are not version 1 collections', () => {
    expect(parseError([])).toBe('collection.json: expected a JSON object.')
    expect(parseError({ datasets: [{ dataset: 'a' }] })).toBe(
      'collection.json: "version" is required; use 1.',
    )
    expect(parseError({ version: 2, datasets: [{ dataset: 'a' }] })).toBe(
      'collection.json: "version" 2 is not supported; this viewer reads version 1.',
    )
    expect(parseError({ version: 1, platform: 'xenium' })).toMatch(
      /this is a dataset manifest, not a collection; open it with dataset=/,
    )
  })

  it('reports unknown fields and bad entries by path', () => {
    expect(
      parseError({ version: 1, datasets: [{ dataset: 'a' }], reference: {} }),
    ).toMatch(/unknown field "reference"/)
    expect(parseError({ version: 1 })).toBe('collection.json: "datasets" is required.')
    expect(parseError({ version: 1, datasets: [] })).toBe(
      'collection.json: "datasets" must be a non-empty array.',
    )
    expect(parseError({ version: 1, datasets: ['a.h5ad'] })).toBe(
      'collection.json: "datasets[0]" must be an object.',
    )
    expect(parseError({ version: 1, datasets: [{ name: 'A' }] })).toBe(
      'collection.json: "datasets[0].dataset" is required.',
    )
    expect(parseError({ version: 1, datasets: [{ dataset: 'a', url: 'b' }] })).toMatch(
      /unknown field "datasets\[0\]\.url"/,
    )
    // A newer version is named before its unknown fields (EXP-215).
    expect(parseError({ version: 2, groupsFirst: true, datasets: [] })).toBe(
      'collection.json: "version" 2 is not supported; this viewer reads version 1.',
    )
    expect(parseError({ version: 1, datasets: [{ dataset: 's3://bucket/a' }] })).toBe(
      'collection.json: "datasets[0].dataset" must be a relative path or an http(s) URL.',
    )
  })

  it('resolves entries as URLs, inside a root with a query (EXP-211, EXP-212)', () => {
    expect(
      parse({ version: 1, datasets: [{ dataset: './run:1/a.zarr' }] }).datasets[0]?.url,
    ).toBe('https://example.test/studies/injury/run:1/a.zarr')
    expect(
      parse({
        version: 1,
        root: 'https://bucket.example.test/study?token=abc',
        datasets: [{ dataset: 'a.zarr' }],
      }).datasets[0]?.url,
    ).toBe('https://bucket.example.test/study/a.zarr?token=abc')
    expect(
      parseError({ version: 1, datasets: [{ dataset: 'da\tta:text/plain,a' }] }),
    ).toBe(
      'collection.json: "datasets[0].dataset" must not contain control characters such as tabs or line breaks.',
    )
  })

  it('pairs an image with a dataset, resolved like the dataset', () => {
    const collection = parse({
      version: 1,
      root: 'https://bucket.example.test/SPCOX/',
      datasets: [
        {
          dataset: 'SPCOX-Sham-A-anndata.zarr',
          image: './SPCOX-Sham-A-raw.zarr/',
          labels: 'SPCOX-Sham-A-label.zarr',
          coordinates: 'image-pixels',
        },
        { dataset: 'b.h5ad', image: 'https://images.example.test/b.ome.tif' },
        { dataset: 'atlas.h5ad' },
      ],
    })

    expect(collection.datasets.map((entry) => entry.image)).toEqual([
      {
        path: 'SPCOX-Sham-A-raw.zarr',
        url: 'https://bucket.example.test/SPCOX/SPCOX-Sham-A-raw.zarr',
        coordinates: 'image-pixels',
        labels: {
          path: 'SPCOX-Sham-A-label.zarr',
          url: 'https://bucket.example.test/SPCOX/SPCOX-Sham-A-label.zarr',
        },
      },
      {
        path: 'https://images.example.test/b.ome.tif',
        url: 'https://images.example.test/b.ome.tif',
        coordinates: 'micrometers',
      },
      undefined,
    ])
  })

  it('rejects bad image entries', () => {
    expect(
      parseError({ version: 1, datasets: [{ dataset: 'a', image: 's3://bucket/a' }] }),
    ).toBe(
      'collection.json: "datasets[0].image" must be a relative path or an http(s) URL.',
    )
    expect(
      parseError({
        version: 1,
        datasets: [{ dataset: 'a', image: 'a.zarr', coordinates: 'pixels' }],
      }),
    ).toBe(
      'collection.json: "datasets[0].coordinates" must be one of "micrometers", "image-pixels".',
    )
    expect(
      parseError({
        version: 1,
        datasets: [{ dataset: 'a', coordinates: 'image-pixels' }],
      }),
    ).toBe('collection.json: "datasets[0].coordinates" needs "datasets[0].image".')
    expect(
      parseError({ version: 1, datasets: [{ dataset: 'a', labels: 'a-label.zarr' }] }),
    ).toBe('collection.json: "datasets[0].labels" needs "datasets[0].image".')
    expect(
      parseError({
        version: 1,
        datasets: [{ dataset: 'a', image: 'a.zarr', labelColumn: 'cell_labels' }],
      }),
    ).toBe('collection.json: "datasets[0].labelColumn" needs "datasets[0].labels".')
    expect(
      parse({
        version: 1,
        datasets: [
          {
            dataset: 'a',
            image: 'a.zarr',
            labels: 'a-label.zarr',
            labelColumn: ' cell_labels ',
          },
        ],
      }).datasets[0]?.image?.labelColumn,
    ).toBe('cell_labels')
  })

  it('takes polygon labels with their format and units', () => {
    const collection = parse({
      version: 1,
      datasets: [
        {
          dataset: 'a.zarr',
          image: 'a-raw.zarr',
          coordinates: 'image-pixels',
          labels: 'outs/cell_boundaries.parquet',
          labelsCoordinates: 'micrometers',
          labelColumn: 'cell_id',
        },
        {
          dataset: 'b.zarr',
          image: 'b-raw.zarr',
          labels: 'b-cells?download=1',
          labelsFormat: 'geojson',
        },
      ],
    })

    expect(collection.datasets.map((entry) => entry.image)).toMatchObject([
      {
        labels: { path: 'outs/cell_boundaries.parquet' },
        labelsCoordinates: 'micrometers',
        labelColumn: 'cell_id',
      },
      { labels: { path: 'b-cells?download=1' }, labelsFormat: 'geojson' },
    ])
    expect(collection.datasets[1]?.image).not.toHaveProperty('labelsCoordinates')

    const entryError = (entry: object) =>
      parseError({
        version: 1,
        datasets: [{ dataset: 'a', image: 'a.zarr', ...entry }],
      })
    expect(entryError({ labelsFormat: 'parquet' })).toBe(
      'collection.json: "datasets[0].labelsFormat" needs "datasets[0].labels".',
    )
    expect(entryError({ labelsCoordinates: 'micrometers' })).toBe(
      'collection.json: "datasets[0].labelsCoordinates" needs "datasets[0].labels".',
    )
    expect(entryError({ labels: 'a.parquet', labelsFormat: 'xenium' })).toBe(
      'collection.json: "datasets[0].labelsFormat" must be one of "label-tiff", "label-zarr", "geojson", "wkt", "parquet".',
    )
    expect(entryError({ labels: 'a.parquet', labelsCoordinates: 'pixels' })).toBe(
      'collection.json: "datasets[0].labelsCoordinates" must be one of "micrometers", "image-pixels".',
    )
  })

  it('rejects the same dataset listed twice', () => {
    expect(
      parseError({
        version: 1,
        datasets: [
          { dataset: 'https://example.test/studies/injury/a.zarr' },
          { dataset: 'a.zarr/' },
        ],
      }),
    ).toBe(
      'collection.json: "datasets[1].dataset" is the same dataset as "datasets[0].dataset".',
    )
  })

  it('keeps the coordinate system each registered section is in', () => {
    const collection = parse({
      version: 1,
      datasets: [
        { dataset: 's1.zarr', coordinateSystem: ' patient-1 ' },
        { dataset: 's2.zarr', coordinateSystem: 'patient-1' },
        { dataset: 'atlas.zarr' },
      ],
    })

    expect(collection.datasets.map((entry) => entry.coordinateSystem)).toEqual([
      'patient-1',
      'patient-1',
      undefined,
    ])
    expect(
      parseError({
        version: 1,
        datasets: [{ dataset: 's1.zarr', coordinateSystem: '' }],
      }),
    ).toBe('collection.json: "datasets[0].coordinateSystem" must be a non-empty string.')
  })

  it('keeps each serial section’s depth, and every section of a system has one or none does', () => {
    const collection = parse({
      version: 1,
      datasets: [
        { dataset: 's1.zarr', coordinateSystem: 'patient-1', z: 0 },
        { dataset: 's2.zarr', coordinateSystem: 'patient-1', z: 12.5 },
        { dataset: 'p2.zarr', coordinateSystem: 'patient-2' },
        { dataset: 'atlas.zarr' },
      ],
    })

    expect(collection.datasets.map((entry) => entry.z)).toEqual([
      0,
      12.5,
      undefined,
      undefined,
    ])
    expect(
      parseError({
        version: 1,
        datasets: [{ dataset: 's1.zarr', coordinateSystem: 'patient-1', z: '10' }],
      }),
    ).toBe('collection.json: "datasets[0].z" must be a number.')
    expect(parseError({ version: 1, datasets: [{ dataset: 's1.zarr', z: 10 }] })).toBe(
      'collection.json: "datasets[0].z" needs "datasets[0].coordinateSystem": a depth places a section among the others registered to it.',
    )
    expect(
      parseError({
        version: 1,
        datasets: [
          { dataset: 's1.zarr', coordinateSystem: 'patient-1' },
          { dataset: 's2.zarr', coordinateSystem: 'patient-1', z: 10 },
          { dataset: 'p2.zarr', coordinateSystem: 'patient-2' },
        ],
      }),
    ).toBe(
      'collection.json: "datasets[0]" has no "z", but "datasets[1]" in coordinate system "patient-1" has one; give every section of a coordinate system a "z", or none.',
    )
  })

  it('caps the number of datasets', () => {
    const datasets = Array.from({ length: MAX_COLLECTION_DATASETS + 1 }, (_, index) => ({
      dataset: `section-${index}.zarr`,
    }))

    expect(parseError({ version: 1, datasets })).toMatch(/a collection holds up to 500/)
  })

  it('takes only the defaults that apply across datasets', () => {
    expect(
      parseError({
        version: 1,
        datasets: [{ dataset: 'a' }],
        defaults: { imageOpacity: 0.5 },
      }),
    ).toMatch(/unknown field "defaults\.imageOpacity"/)
    expect(
      parseError({
        version: 1,
        datasets: [{ dataset: 'a' }],
        defaults: { genes: 'Aqp4' },
      }),
    ).toBe('collection.json: "defaults.genes" must be an array of non-empty strings.')
  })
})

describe('parseDatasetManifest', () => {
  it('points a collection opened as a dataset at collection=', () => {
    expect(() =>
      parseDatasetManifest({ version: 1, datasets: [{ dataset: 'a' }] }, COLLECTION_URL),
    ).toThrow(DatasetManifestError)
    expect(() =>
      parseDatasetManifest({ version: 1, datasets: [{ dataset: 'a' }] }, COLLECTION_URL),
    ).toThrow(/this is a dataset collection; open it with collection=/)
  })
})

describe('collectionEntryFor', () => {
  const collection = parse({
    version: 1,
    datasets: [{ dataset: 'a.zarr' }, { dataset: 'b/explorer.json' }],
  })

  it('finds the entry a dataset URL names, ignoring trailing slashes', () => {
    expect(
      collectionEntryFor(collection, 'https://example.test/studies/injury/a.zarr/')?.path,
    ).toBe('a.zarr')
    expect(
      collectionEntryFor(
        collection,
        ' https://example.test/studies/injury/b/explorer.json',
      )?.path,
    ).toBe('b/explorer.json')
    expect(collectionEntryFor(collection, 'https://example.test/other.zarr')).toBe(
      undefined,
    )
    expect(collectionEntryFor(collection, null)).toBe(undefined)
  })
})

describe('collectionGroups', () => {
  it('groups entries in the order each group first appears', () => {
    const collection = parse({
      version: 1,
      datasets: [
        { dataset: 'reference.zarr' },
        { dataset: 'sham-a.zarr', group: 'Sham' },
        { dataset: '1dpi-a.zarr', group: '1 dpi' },
        { dataset: 'sham-b.zarr', group: 'Sham' },
        { dataset: 'extra-1.zarr' },
        { dataset: 'extra-2.zarr' },
      ],
    })

    expect(
      collectionGroups(collection).map((group) => [
        group.name,
        group.datasets.map((entry) => entry.path),
      ]),
    ).toEqual([
      [undefined, ['reference.zarr']],
      ['Sham', ['sham-a.zarr', 'sham-b.zarr']],
      ['1 dpi', ['1dpi-a.zarr']],
      [undefined, ['extra-1.zarr', 'extra-2.zarr']],
    ])
  })
})

describe('fetchDatasetCollection', () => {
  const valid = { version: 1, datasets: [{ dataset: 'a.zarr' }] }

  it('reads the collection without the HTTP cache', async () => {
    const fetchImpl = vi.fn(async () => Response.json(valid))

    const collection = await fetchDatasetCollection(COLLECTION_URL, { fetchImpl })

    expect(collection.datasets).toHaveLength(1)
    expect(fetchImpl).toHaveBeenCalledWith(
      COLLECTION_URL,
      expect.objectContaining({ cache: 'no-cache' }),
    )
  })

  it('explains HTTP errors, unreadable files and invalid JSON', async () => {
    await expect(
      fetchDatasetCollection(COLLECTION_URL, {
        fetchImpl: async () => new Response('', { status: 404 }),
      }),
    ).rejects.toThrow('collection.json: the file answered HTTP 404.')
    await expect(
      fetchDatasetCollection(COLLECTION_URL, {
        fetchImpl: async () => {
          throw new TypeError('Failed to fetch')
        },
      }),
    ).rejects.toThrow(/could not be read\. Check the URL and that the host allows/)
    await expect(
      fetchDatasetCollection(COLLECTION_URL, {
        fetchImpl: async () => new Response('<html>'),
      }),
    ).rejects.toThrow('collection.json: the file is not JSON.')
  })

  it('gives up after the timeout', async () => {
    const fetchImpl = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'))
          })
        }),
    )

    await expect(
      fetchDatasetCollection(COLLECTION_URL, { fetchImpl, timeoutMs: 10 }),
    ).rejects.toThrow('collection.json: the file did not answer within 0.01 s.')
  })

  it('tells a body that stalls or breaks off from one that is not JSON (EXP-214)', async () => {
    // Headers at once, then part of the body; the rest never comes, or the
    // connection drops.
    const partialBody =
      (drop: boolean) => (_url: RequestInfo | URL, init?: RequestInit) =>
        Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(
                  new TextEncoder().encode('{"version": 1, "datasets": ['),
                )
                if (drop) controller.error(new TypeError('network error'))
                init?.signal?.addEventListener('abort', () => {
                  controller.error(new DOMException('Aborted', 'AbortError'))
                })
              },
            }),
          ),
        )

    await expect(
      fetchDatasetCollection(COLLECTION_URL, {
        fetchImpl: partialBody(false),
        timeoutMs: 10,
      }),
    ).rejects.toThrow('collection.json: the file did not answer within 0.01 s.')
    await expect(
      fetchDatasetCollection(COLLECTION_URL, { fetchImpl: partialBody(true) }),
    ).rejects.toThrow('collection.json: the file broke off before it was read whole.')
  })

  it('does not start a read for a caller that has already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetchImpl = vi.fn()

    await expect(
      fetchDatasetCollection(COLLECTION_URL, { fetchImpl, signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('passes a caller abort through unchanged', async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'))
          })
        }),
    )
    const pending = fetchDatasetCollection(COLLECTION_URL, {
      fetchImpl,
      signal: controller.signal,
    })
    controller.abort()

    await expect(pending).rejects.toThrow('Aborted')
  })
})
