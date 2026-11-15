import { gzipSync } from 'node:zlib'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  MatrixMarketCsrParser,
  parseMexBarcodes,
  parseMexFeatures,
  readFeatureBarcodeMex,
  type MatrixMarketCsr,
} from './featureBarcodeMex'

type Entry = readonly [feature: number, barcode: number, value: number | string]

// 3 features × 4 barcodes, 1-based entries in Space Ranger's order: by
// barcode, then feature. Barcode 3 (index 2) has no entries.
const ENTRIES: readonly Entry[] = [
  [1, 1, 5],
  [3, 1, 1],
  [2, 2, 7],
  [1, 4, 2],
  [2, 4, 3],
  [3, 4, 4],
]

function mexText(
  entries: readonly Entry[],
  options: {
    readonly field?: string
    readonly comments?: readonly string[]
    readonly size?: string
    readonly newline?: string
  } = {},
): string {
  const { field = 'integer', comments = [], newline = '\n' } = options
  return [
    `%%MatrixMarket matrix coordinate ${field} general`,
    ...comments,
    options.size ?? `3 4 ${entries.length.toString()}`,
    ...entries.map((entry) => entry.join(' ')),
    '',
  ].join(newline)
}

function parse(text: string, chunkSizes: readonly number[] = []): MatrixMarketCsr {
  const bytes = new TextEncoder().encode(text)
  const parser = new MatrixMarketCsrParser('matrix.mtx')
  let offset = 0

  for (const size of chunkSizes) {
    parser.push(bytes.subarray(offset, offset + size))
    offset += size
  }

  parser.push(bytes.subarray(offset))
  return parser.finish()
}

function rows(csr: MatrixMarketCsr): number[][][] {
  return Array.from({ length: csr.barcodeCount }, (_unused, row) => {
    const start = csr.indptr[row] ?? 0
    const end = csr.indptr[row + 1] ?? start
    return Array.from({ length: end - start }, (_entry, offset) => [
      csr.indices[start + offset] ?? -1,
      csr.data[start + offset] ?? -1,
    ])
  })
}

const EXPECTED_ROWS = [
  [
    [0, 5],
    [2, 1],
  ],
  [[1, 7]],
  [],
  [
    [0, 2],
    [1, 3],
    [2, 4],
  ],
]

describe('MatrixMarketCsrParser', () => {
  it('reads features × barcodes entries into barcode rows', () => {
    const csr = parse(
      mexText(ENTRIES, {
        comments: [
          '%metadata_json: {"software_version": "spaceranger-1.2.2", "format_version": 2}',
        ],
      }),
    )

    expect(csr).toMatchObject({
      featureCount: 3,
      barcodeCount: 4,
      softwareVersion: 'spaceranger-1.2.2',
    })
    expect(csr.data).toBeInstanceOf(Int32Array)
    expect(Array.from(csr.indptr)).toEqual([0, 2, 3, 3, 6])
    expect(rows(csr)).toEqual(EXPECTED_ROWS)
  })

  it('gives the same rows however the bytes are split', () => {
    const text = mexText(ENTRIES, { comments: ['% a comment'], newline: '\r\n' })

    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 12 }), { maxLength: 30 }),
        (sizes) => {
          expect(rows(parse(text, sizes))).toEqual(EXPECTED_ROWS)
        },
      ),
    )
  })

  it('sorts entries that are not in barcode or feature order', () => {
    const shuffled: Entry[] = [
      [3, 4, 4],
      [2, 2, 7],
      [1, 4, 2],
      [3, 1, 1],
      [2, 4, 3],
      [1, 1, 5],
    ]
    expect(rows(parse(mexText(shuffled)))).toEqual(EXPECTED_ROWS)

    // Barcode order with features descending in a row.
    const reversed: Entry[] = [
      [3, 1, 1],
      [1, 1, 5],
      [2, 2, 7],
      [3, 4, 4],
      [2, 4, 3],
      [1, 4, 2],
    ]
    expect(rows(parse(mexText(reversed)))).toEqual(EXPECTED_ROWS)
  })

  it('reads real and pattern matrices, and skips blank lines', () => {
    const real = parse(
      mexText(
        [
          [1, 1, '0.5'],
          [2, 2, '-1.25e1'],
        ],
        { field: 'real' },
      ).replace('\n1 1', '\n\n  1 1'),
    )
    expect(real.data).toBeInstanceOf(Float32Array)
    expect(Array.from(real.data)).toEqual([0.5, -12.5])

    const pattern = parse(
      ['%%MatrixMarket matrix coordinate pattern general', '3 4 2', '1 1', '3 4'].join(
        '\n',
      ),
    )
    expect(rows(pattern)).toEqual([[[0, 1]], [], [], [[2, 1]]])
  })

  it('reports files it cannot read', () => {
    expect(() => parse('barcode,count\n')).toThrow(
      'matrix.mtx is not a Matrix Market file.',
    )
    expect(() => parse('%%MatrixMarket matrix array real general\n3 4\n')).toThrow(
      /unsupported kind \(matrix array real general\)/,
    )
    expect(() => parse(mexText(ENTRIES.slice(0, 4), { size: '3 4 6' }))).toThrow(
      'matrix.mtx ends after 4 of 6 entries.',
    )
    expect(() => parse(mexText(ENTRIES, { size: '3 4 5' }))).toThrow(
      'matrix.mtx has more than the 5 entries its size line declares.',
    )
    expect(() => parse(mexText([[4, 1, 1]], { size: '3 4 1' }))).toThrow(
      'matrix.mtx entry 1 has an invalid row index (4).',
    )
    expect(() => parse(mexText([[1, 0, 1]], { size: '3 4 1' }))).toThrow(
      'matrix.mtx entry 1 has an invalid column index (0).',
    )
    expect(() => parse(mexText([[1, 1, '2.5']], { size: '3 4 1' }))).toThrow(
      'matrix.mtx entry 1 has an invalid value (2.5).',
    )
    expect(() => parse('%%MatrixMarket matrix coordinate integer general\n')).toThrow(
      'matrix.mtx has no Matrix Market size line.',
    )
  })
})

describe('MEX barcode and feature lists', () => {
  it('reads barcodes and Cell Ranger 3+ or Cell Ranger 2 features', () => {
    expect(parseMexBarcodes('AAAC-1\r\nAAAG-1\n\n')).toEqual(['AAAC-1', 'AAAG-1'])
    expect(
      parseMexFeatures('ENSG1\tACTB\tGene Expression\nCD3\tCD3\tAntibody Capture\n'),
    ).toEqual({
      ids: ['ENSG1', 'CD3'],
      names: ['ACTB', 'CD3'],
      types: ['Gene Expression', 'Antibody Capture'],
    })
    expect(parseMexFeatures('ENSG1\tACTB\nENSG2\n')).toEqual({
      ids: ['ENSG1', 'ENSG2'],
      names: ['ACTB', 'ENSG2'],
      types: ['Gene Expression', 'Gene Expression'],
    })
  })
})

describe('readFeatureBarcodeMex', () => {
  const ROOT = 'https://example.test/outs/filtered_feature_bc_matrix'
  const URLS = {
    matrix: `${ROOT}/matrix.mtx.gz`,
    barcodes: `${ROOT}/barcodes.tsv.gz`,
    features: `${ROOT}/features.tsv.gz`,
  }
  const FEATURES =
    'G1\tActb\tGene Expression\nG2\tGad1\tGene Expression\nG3\tMbp\tGene Expression\n'

  function fetcherFor(files: Readonly<Record<string, BodyInit>>): typeof fetch {
    return (async (input: RequestInfo | URL) => {
      const body = files[String(input)]
      return body === undefined ? new Response(null, { status: 404 }) : new Response(body)
    }) as typeof fetch
  }

  it('reads gzipped GEO-style files into a feature-barcode matrix', async () => {
    const progress: string[] = []
    const matrix = await readFeatureBarcodeMex({
      urls: URLS,
      fetcher: fetcherFor({
        [URLS.matrix]: gzipSync(mexText(ENTRIES)),
        [URLS.barcodes]: gzipSync('B1-1\nB2-1\nB3-1\nB4-1\n'),
        [URLS.features]: gzipSync(FEATURES),
      }),
      onProgress: (message) => progress.push(message),
    })

    expect(matrix).toMatchObject({
      barcodes: ['B1-1', 'B2-1', 'B3-1', 'B4-1'],
      featureNames: ['Actb', 'Gad1', 'Mbp'],
      featureIds: ['G1', 'G2', 'G3'],
    })
    expect(Array.from(matrix.indptr)).toEqual([0, 2, 3, 3, 6])
    expect(Array.from(matrix.data)).toEqual([5, 1, 7, 2, 3, 4])
    expect(progress).toEqual(['matrix.mtx.gz read: 4 barcodes × 3 features, 6 non-zero'])
  })

  it('checks the lists against the matrix shape and the matrix size', async () => {
    await expect(
      readFeatureBarcodeMex({
        urls: URLS,
        fetcher: fetcherFor({
          [URLS.matrix]: mexText(ENTRIES),
          [URLS.barcodes]: 'B1-1\nB2-1\n',
          [URLS.features]: FEATURES,
        }),
      }),
    ).rejects.toThrow('barcodes.tsv.gz lists 2 barcodes; matrix.mtx.gz has 4 columns.')

    await expect(
      readFeatureBarcodeMex({
        urls: URLS,
        fetcher: (async (input: RequestInfo | URL) =>
          String(input) === URLS.matrix
            ? new Response('x', {
                headers: { 'Content-Length': String(400 * 1024 * 1024) },
              })
            : new Response('')) as typeof fetch,
      }),
    ).rejects.toThrow(/400\.0 MB, above the 300\.0 MB browser load limit/)

    await expect(
      readFeatureBarcodeMex({ urls: URLS, fetcher: fetcherFor({}) }),
    ).rejects.toThrow('returned HTTP 404.')
  })
})
