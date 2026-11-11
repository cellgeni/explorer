import { describe, expect, it } from 'vitest'
import { datasetDisplayName, documentTitle } from './documentTitle'

describe('document title', () => {
  it('names the app alone before a dataset loads', () => {
    expect(documentTitle(null)).toBe('Spatial Omics Explorer')
  })

  it('prefers the manifest name', () => {
    expect(datasetDisplayName('https://example.test/data/', ' Mouse brain ')).toBe(
      'Mouse brain',
    )
    expect(documentTitle('Mouse brain')).toBe('Mouse brain · Spatial Omics Explorer')
  })

  it('uses the last meaningful part of the URL', () => {
    expect(datasetDisplayName('https://example.test/h5ad/pbmc3k.h5ad?x=1', '')).toBe(
      'pbmc3k.h5ad',
    )
    expect(
      datasetDisplayName('https://example.test/run/sample%201/outs/', undefined),
    ).toBe('sample 1')
    expect(
      datasetDisplayName('https://example.test/xenium/run/experiment.xenium', undefined),
    ).toBe('run')
    expect(datasetDisplayName('/visium-smoke/', undefined)).toBe('visium-smoke')
    expect(datasetDisplayName(null, undefined)).toBeNull()
  })
})
