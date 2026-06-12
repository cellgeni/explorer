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

  it('falls back to transcripts.zarr.zip genes when gene_panel.json is missing', async () => {
    const signal = new AbortController().signal
    const fetcher = vi.fn(async () => new Response(null, { status: 404 }))
    const loadTranscriptZarrGenePanel = vi.fn(async () => ['Actb', 'Gad1'])

    await expect(
      loadGenePanel('https://example.test/xenium/', {
        fetcher,
        loadTranscriptZarrGenePanel,
        signal,
      }),
    ).resolves.toEqual(['Actb', 'Gad1'])

    expect(fetcher).toHaveBeenCalledWith('https://example.test/xenium/gene_panel.json', {
      signal,
    })
    expect(loadTranscriptZarrGenePanel).toHaveBeenCalledWith(
      'https://example.test/xenium/transcripts.zarr.zip',
      { signal },
    )
  })

  it('reports both gene panel and transcript Zarr fallback failures', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 404 }))
    const loadTranscriptZarrGenePanel = vi.fn(async () => {
      throw new Error('missing gene_names metadata')
    })

    await expect(
      loadGenePanel('https://example.test/xenium/', {
        fetcher,
        loadTranscriptZarrGenePanel,
      }),
    ).rejects.toThrow(
      'Unable to load gene panel from gene_panel.json (Unable to load gene_panel.json: HTTP 404.) or transcripts.zarr.zip (missing gene_names metadata).',
    )
  })
})
