import { describe, expect, it, vi } from 'vitest'
import { loadGenePanel, parseGenePanel } from './genePanel'

describe('gene panel loader', () => {
  it('extracts sorted gene names from common Xenium panel shapes', () => {
    expect(
      parseGenePanel({
        payload: {
          targets: [
            { gene_name: 'Gad1', type: 'Gene' },
            { gene_name: 'NegControlProbe_001', type: 'Gene' },
            { feature_name: 'Slc17a7', feature_type: 'Gene Expression' },
            {
              type: {
                descriptor: 'gene',
                data: {
                  name: 'A2ML1',
                },
              },
            },
            { gene_name: 'Gad1', type: 'Gene' },
          ],
        },
      }),
    ).toEqual(['A2ML1', 'Gad1', 'Slc17a7'])
  })

  it('fetches gene_panel.json from the dataset root', async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        payload: {
          targets: [{ gene_name: 'Actb', type: 'Gene' }],
        },
      }),
    )

    await expect(
      loadGenePanel('https://example.test/xenium/', { fetcher }),
    ).resolves.toEqual(['Actb'])
    expect(fetcher).toHaveBeenCalledWith('https://example.test/xenium/gene_panel.json')
  })
})
