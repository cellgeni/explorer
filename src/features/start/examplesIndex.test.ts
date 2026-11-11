import { describe, expect, it, vi } from 'vitest'
import {
  clearCachedExamples,
  DEFAULT_EXAMPLES_INDEX_URL,
  examplesIndexUrl,
  ExamplesIndexError,
  fetchExamplesIndex,
  parseExamplesIndex,
  readCachedExamples,
  writeCachedExamples,
} from './examplesIndex'
import { memoryStorage } from '../../test/memoryStorage'

const SKIN = {
  id: 'bia/S-BIAD2214',
  path: 'bia/S-BIAD2214.json',
  manifestUrl:
    'https://raw.githubusercontent.com/cellgeni/explorer/main/examples/bia/S-BIAD2214.json',
  viewerUrl: 'https://cellgeni.github.io/explorer/?dataset=…',
  platform: 'xenium',
  name: 'Human skin, inflamed eczema (Xenium 5K)',
  description: 'Fresh-frozen adult skin.',
  source: {
    repository: 'BioImage Archive',
    accession: 'S-BIAD2214',
    url: 'https://www.ebi.ac.uk/biostudies/BioImages/studies/S-BIAD2214',
    license: 'CC0 1.0',
    citation: 'Steele L et al. (2025)',
  },
}

describe('examplesIndexUrl', () => {
  it('uses GitHub unless the build names another index', () => {
    expect(examplesIndexUrl(undefined)).toBe(DEFAULT_EXAMPLES_INDEX_URL)
    expect(examplesIndexUrl('  ')).toBe(DEFAULT_EXAMPLES_INDEX_URL)
    expect(examplesIndexUrl('https://example.test/index.json')).toBe(
      'https://example.test/index.json',
    )
  })
})

describe('parseExamplesIndex', () => {
  it('keeps the text the gallery shows and drops the rest', () => {
    expect(parseExamplesIndex({ version: 1, examples: [SKIN] })).toEqual([
      {
        id: 'bia/S-BIAD2214',
        name: 'Human skin, inflamed eczema (Xenium 5K)',
        manifestUrl: SKIN.manifestUrl,
        platform: 'xenium',
        description: 'Fresh-frozen adult skin.',
        source: {
          repository: 'BioImage Archive',
          accession: 'S-BIAD2214',
          url: SKIN.source.url,
          license: 'CC0 1.0',
        },
      },
    ])
  })

  it('skips invalid entries and ignores unknown fields', () => {
    const examples = parseExamplesIndex({
      version: 1,
      generatedBy: 'a newer script',
      examples: [
        null,
        'bia/S-BIAD2214',
        { ...SKIN, id: '' },
        { ...SKIN, id: 'no-name', name: 3 },
        { ...SKIN, id: 'script', manifestUrl: 'javascript:alert(1)' },
        { ...SKIN, id: 'relative', manifestUrl: 'bia/S-BIAD2214.json' },
        { ...SKIN, futureField: { nested: true } },
        { ...SKIN, name: 'A duplicate id' },
        {
          id: 'minimal',
          name: '<b>Bold</b>',
          manifestUrl: 'http://example.test/explorer.json',
          source: { url: 'javascript:alert(1)', license: 'CC BY 4.0' },
        },
      ],
    })

    expect(examples.map((example) => example.id)).toEqual(['bia/S-BIAD2214', 'minimal'])
    // Text stays text; the link to a non-http source is dropped.
    expect(examples[1]).toEqual({
      id: 'minimal',
      name: '<b>Bold</b>',
      manifestUrl: 'http://example.test/explorer.json',
      source: { license: 'CC BY 4.0' },
    })
  })

  it('accepts only version 1 with an examples list', () => {
    expect(() => parseExamplesIndex({ version: 2, examples: [] })).toThrow(
      ExamplesIndexError,
    )
    expect(() => parseExamplesIndex({ version: 1 })).toThrow(ExamplesIndexError)
    expect(() => parseExamplesIndex([SKIN])).toThrow(ExamplesIndexError)
    expect(parseExamplesIndex({ version: 1, examples: [] })).toEqual([])
  })

  it('reads the index in this repository', async () => {
    const { readFileSync } = await import('node:fs')
    const index: unknown = JSON.parse(readFileSync('examples/index.json', 'utf8'))
    const { examples } = index as { readonly examples: readonly unknown[] }

    expect(parseExamplesIndex(index)).toHaveLength(examples.length)
  })
})

describe('fetchExamplesIndex', () => {
  it('fetches and parses the index', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ version: 1, examples: [SKIN] }))

    await expect(
      fetchExamplesIndex(DEFAULT_EXAMPLES_INDEX_URL, { fetchImpl }),
    ).resolves.toHaveLength(1)
    expect(fetchImpl).toHaveBeenCalledWith(
      DEFAULT_EXAMPLES_INDEX_URL,
      expect.objectContaining({ signal: expect.any(AbortSignal) as AbortSignal }),
    )
  })

  it('reports an HTTP error', async () => {
    const fetchImpl = vi.fn(async () => new Response('missing', { status: 404 }))

    await expect(
      fetchExamplesIndex(DEFAULT_EXAMPLES_INDEX_URL, { fetchImpl }),
    ).rejects.toThrow('The examples index answered HTTP 404.')
  })

  it('gives up after the timeout', async () => {
    vi.useFakeTimers()
    try {
      const fetchImpl = vi.fn(
        (_url: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new DOMException('Aborted', 'AbortError'))
            })
          }),
      )
      const result = fetchExamplesIndex(DEFAULT_EXAMPLES_INDEX_URL, {
        fetchImpl,
        timeoutMs: 5_000,
      })
      const expectation = expect(result).rejects.toThrow(
        'The examples index did not answer within 5 s.',
      )

      await vi.advanceTimersByTimeAsync(5_000)
      await expectation
    } finally {
      vi.useRealTimers()
    }
  })

  it('passes on the caller aborting', async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'))
          })
        }),
    )
    const result = fetchExamplesIndex(DEFAULT_EXAMPLES_INDEX_URL, {
      fetchImpl,
      signal: controller.signal,
    })
    controller.abort()

    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('the session cache', () => {
  it('keeps the parsed examples per index URL', () => {
    const storage = memoryStorage()
    const examples = parseExamplesIndex({ version: 1, examples: [SKIN] })

    expect(readCachedExamples(storage, DEFAULT_EXAMPLES_INDEX_URL)).toBeNull()
    writeCachedExamples(storage, DEFAULT_EXAMPLES_INDEX_URL, examples)
    expect(readCachedExamples(storage, DEFAULT_EXAMPLES_INDEX_URL)).toEqual(examples)
    expect(readCachedExamples(storage, 'https://example.test/index.json')).toBeNull()

    clearCachedExamples(storage, DEFAULT_EXAMPLES_INDEX_URL)
    expect(readCachedExamples(storage, DEFAULT_EXAMPLES_INDEX_URL)).toBeNull()
  })

  it('treats missing, refusing or corrupt storage as no cache', () => {
    const refusing = {
      getItem: () => {
        throw new DOMException('Denied', 'SecurityError')
      },
      setItem: () => {
        throw new DOMException('Full', 'QuotaExceededError')
      },
      removeItem: () => {
        throw new DOMException('Denied', 'SecurityError')
      },
    }
    const corrupt = memoryStorage()
    corrupt.setItem(`explorer.examples:${DEFAULT_EXAMPLES_INDEX_URL}`, '{not json')

    expect(readCachedExamples(null, DEFAULT_EXAMPLES_INDEX_URL)).toBeNull()
    expect(readCachedExamples(refusing, DEFAULT_EXAMPLES_INDEX_URL)).toBeNull()
    expect(readCachedExamples(corrupt, DEFAULT_EXAMPLES_INDEX_URL)).toBeNull()
    expect(() => {
      writeCachedExamples(refusing, DEFAULT_EXAMPLES_INDEX_URL, [])
      clearCachedExamples(refusing, DEFAULT_EXAMPLES_INDEX_URL)
    }).not.toThrow()
  })
})
