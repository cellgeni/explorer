import { describe, expect, it, vi } from 'vitest'
import { loadDatasetCollection } from './annDataSectionCollection'
import type { AnnDataSection } from './h5adDataset'

const FILE = 'https://example.test/ef6/aligned.h5ad'

function table(
  columns: readonly string[],
  sections: readonly AnnDataSection[],
): { readonly openDataset: (url: string) => Promise<unknown> } {
  return {
    openDataset: vi.fn(async () => ({
      sectionColumns: async () => columns,
      sections: async () => sections,
    })),
  }
}

describe('loadDatasetCollection', () => {
  it('splits an AnnData table by its section column, stacked by depth', async () => {
    const { openDataset } = table(
      ['section', 'niche'],
      [
        { value: 'section_01', cellCount: 3, z: 0 },
        { value: 'section_02', cellCount: 2, z: 60 },
      ],
    )

    await expect(loadDatasetCollection(FILE, { openDataset })).resolves.toEqual({
      url: FILE,
      name: 'aligned.h5ad by section',
      datasets: [
        {
          path: `${FILE}#obs.section=section_01`,
          url: `${FILE}#obs.section=section_01`,
          name: 'section_01',
          coordinateSystem: 'aligned.h5ad',
          z: 0,
        },
        {
          path: `${FILE}#obs.section=section_02`,
          url: `${FILE}#obs.section=section_02`,
          name: 'section_02',
          coordinateSystem: 'aligned.h5ad',
          z: 60,
        },
      ],
    })
    expect(openDataset).toHaveBeenCalledWith(FILE)
  })

  it('splits by the column the fragment names, without depths unless all have one', async () => {
    const { openDataset } = table(
      ['section', 'niche'],
      [
        { value: 'dermis', cellCount: 3, z: 0 },
        { value: 'epidermis', cellCount: 2 },
      ],
    )
    const collection = await loadDatasetCollection(
      'https://example.test/ef6/aligned.zarr/#obs.niche',
      { openDataset },
    )

    expect(openDataset).toHaveBeenCalledWith('https://example.test/ef6/aligned.zarr')
    expect(collection.name).toBe('aligned.zarr by niche')
    expect(collection.datasets.map((entry) => [entry.url, entry.z])).toEqual([
      ['https://example.test/ef6/aligned.zarr#obs.niche=dermis', undefined],
      ['https://example.test/ef6/aligned.zarr#obs.niche=epidermis', undefined],
    ])
  })

  it('asks for a column when none is named like a section', async () => {
    const { openDataset } = table(['niche', 'cell_cluster'], [])

    await expect(loadDatasetCollection(FILE, { openDataset })).rejects.toThrow(
      `aligned.h5ad: name the obs column that splits the table into sections, as ${FILE}#obs.niche. Columns with 2 to 500 values: niche, cell_cluster.`,
    )
  })

  it('refuses one section, and what is not an AnnData table', async () => {
    await expect(
      loadDatasetCollection(`${FILE}#obs.section=section_01`, table([], [])),
    ).rejects.toThrow('this names one section; open it with dataset= in the address')
    await expect(
      loadDatasetCollection('https://example.test/sdata.zarr', {
        openDataset: async () => ({ meta: async () => ({}) }),
      }),
    ).rejects.toThrow('this is not an AnnData table')
  })

  it('reports a table that cannot be read', async () => {
    await expect(
      loadDatasetCollection(FILE, {
        openDataset: async () => {
          throw new Error('H5AD file returned HTTP 404.')
        },
      }),
    ).rejects.toThrow(
      'aligned.h5ad: the table could not be split into sections: H5AD file returned HTTP 404',
    )
  })

  it('reads any other URL as a collection JSON file', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ version: 1, datasets: [{ dataset: 'a.h5ad' }] }),
    )

    await expect(
      loadDatasetCollection('https://example.test/study/collection.json', {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toMatchObject({
      datasets: [{ url: 'https://example.test/study/a.h5ad' }],
    })
  })
})
