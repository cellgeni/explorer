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

  it('names one section of a table after the file and the section', () => {
    expect(
      datasetDisplayName(
        'https://example.test/ef6/aligned.h5ad#obs.section=section_01',
        undefined,
      ),
    ).toBe('aligned.h5ad · section_01')
    expect(
      datasetDisplayName(
        'https://example.test/ef6/aligned.h5ad#obs.section=section_01',
        'Section 1',
      ),
    ).toBe('Section 1')
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

  it('names a dataset served from the root of a host by the host', () => {
    // As `npx http-server <folder>` serves it (docs/host-your-own-data.md).
    expect(datasetDisplayName('http://127.0.0.1:8080/', undefined)).toBe('127.0.0.1:8080')
    expect(datasetDisplayName('https://data.example.org', undefined)).toBe(
      'data.example.org',
    )
    expect(documentTitle(datasetDisplayName('http://localhost:3000/', undefined))).toBe(
      'localhost:3000 · Spatial Omics Explorer',
    )
  })
})
