// FMT review: runs the inert probes, the examples, docs/collections and the
// manifest/collection JSON blocks in the docs through the runtime parsers,
// and compares each verdict with (a) a hand-written expectation and (b) the
// JSON Schema verdict from schema_validate.py (jsonschema, Draft 2020-12).
// Expected values are written by hand, not computed with production helpers.
//
//   uv run --offline --no-project --with jsonschema python \
//     docs/review/2026-11-19/evidence/docs-formats/schema_validate.py
//   npx vitest run --config docs/review/2026-11-19/evidence/repro/vitest.repro.config.ts \
//     docs/review/2026-11-19/evidence/repro/docs-formats/schemaParserProbes.repro.ts
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseDatasetCollection } from '../../../../../../src/datasets/datasetCollection'
import { parseDatasetManifest } from '../../../../../../src/datasets/datasetManifest'

const root = process.cwd()
const evidence = join(root, 'docs/review/2026-11-19/evidence/docs-formats')
const fixtures = join(root, 'docs/review/2026-11-19/evidence/fixtures/docs-formats')

interface Probe {
  readonly id: string
  readonly kind: 'manifest' | 'collection'
  readonly json?: unknown
  readonly jsonText?: string
  readonly generate?: string
  readonly expectSchema: boolean
  readonly expectParser: boolean
}

const probes = (
  JSON.parse(readFileSync(join(fixtures, 'probes.json'), 'utf8')) as {
    probes: Probe[]
  }
).probes
const schemaResults = JSON.parse(
  readFileSync(join(evidence, 'schema-results.json'), 'utf8'),
) as {
  probes: { id: string; schemaValid: boolean }[]
  files: { file: string; kind: string | null; schemaValid: boolean }[]
}
const docBlocks = JSON.parse(
  readFileSync(join(evidence, 'docs-json-blocks.json'), 'utf8'),
) as { file: string; line: number; kind: string | null; text: string }[]

const MANIFEST_URL = 'https://host.example/study/run-7/explorer.json'
const COLLECTION_URL = 'https://host.example/study/collection.json'

function parse(kind: 'manifest' | 'collection', json: unknown, url?: string) {
  try {
    const value =
      kind === 'manifest'
        ? parseDatasetManifest(json, url ?? MANIFEST_URL)
        : parseDatasetCollection(json, url ?? COLLECTION_URL)
    return { ok: true as const, value }
  } catch (error) {
    return { ok: false as const, message: (error as Error).message }
  }
}

function probeJson(probe: Probe): unknown {
  if (probe.generate === '501') {
    return {
      version: 1,
      datasets: Array.from({ length: 501 }, (_, i) => ({ dataset: `d${i}` })),
    }
  }

  return probe.jsonText === undefined ? probe.json : JSON.parse(probe.jsonText)
}

describe('schema vs parser probes', () => {
  const rows: string[] = []

  it.each(probes)('$id', (probe) => {
    const result = parse(probe.kind, probeJson(probe))
    const schemaValid = schemaResults.probes.find((p) => p.id === probe.id)?.schemaValid
    rows.push(
      `${probe.id}\tschema=${schemaValid}\tparser=${result.ok}\t${
        schemaValid === result.ok ? 'agree' : 'DISAGREE'
      }\t${result.ok ? '' : result.message}`,
    )
    expect(result.ok, result.ok ? '' : result.message).toBe(probe.expectParser)
    expect(schemaValid).toBe(probe.expectSchema)
  })

  it('prints the table', () => {
    process.stdout.write(
      ['probe\tschema\tparser\tverdict\tparser message', ...rows, ''].join('\n'),
    )
  })
})

function jsonFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory()
      ? jsonFiles(path)
      : name.endsWith('.json')
        ? [path]
        : []
  })
}

describe('examples and docs/collections parse and match the schema', () => {
  const files = [
    ...jsonFiles(join(root, 'examples')),
    ...jsonFiles(join(root, 'docs/collections')),
  ]
    .map((path) => relative(root, path))
    .filter((path) => path !== 'examples/index.json')
    .sort()

  it.each(files)('%s', (file) => {
    const json = JSON.parse(readFileSync(join(root, file), 'utf8')) as Record<
      string,
      unknown
    >
    const kind = 'datasets' in json && !('platform' in json) ? 'collection' : 'manifest'
    // Examples are opened from raw GitHub; docs/collections from their GitHub
    // raw path too. Resolution base does not change validity.
    const url = `https://raw.githubusercontent.com/cellgeni/explorer/main/${file}`
    const result = parse(kind, json, url)
    const schemaValid = schemaResults.files.find((f) => f.file === file)?.schemaValid
    expect(result.ok, result.ok ? '' : result.message).toBe(true)
    expect(schemaValid).toBe(true)
  })
})

describe('docs JSON blocks that are manifests or collections', () => {
  const blocks = docBlocks.filter(
    (block) =>
      block.kind !== null &&
      // h5ad-reference.md's block is a kerchunk reference, not a manifest.
      !block.text.includes('"refs"'),
  )

  it.each(blocks.map((b) => [`${b.file}:${b.line}`, b] as const))('%s', (_, block) => {
    const result = parse(block.kind as 'manifest' | 'collection', JSON.parse(block.text))
    expect(result.ok, result.ok ? '' : result.message).toBe(true)
  })
})

describe('relative path resolution (expected URLs written by hand)', () => {
  it('resolves files against the manifest folder, dropping ./ and trailing /', () => {
    const manifest = parseDatasetManifest(
      {
        version: 1,
        platform: 'xenium',
        files: {
          cells: './tables/cells.parquet',
          transcriptsZarr: 'data/transcripts.zarr.zip/',
          genePanel: '../shared/gene_panel.json',
          analysis: '/abs/analysis.zarr.zip',
          cellFeatureMatrix: 'https://cdn.example.org/m.zarr.zip',
        },
      },
      MANIFEST_URL,
    )
    expect(manifest.rootUrl).toBe('https://host.example/study/run-7')
    expect(manifest.files).toMatchObject({
      cells: {
        path: 'tables/cells.parquet',
        url: 'https://host.example/study/run-7/tables/cells.parquet',
      },
      transcriptsZarr: {
        url: 'https://host.example/study/run-7/data/transcripts.zarr.zip',
      },
      genePanel: { url: 'https://host.example/study/shared/gene_panel.json' },
      analysis: { url: 'https://host.example/abs/analysis.zarr.zip' },
      cellFeatureMatrix: { url: 'https://cdn.example.org/m.zarr.zip' },
    })
  })

  it('resolves root relative to the manifest, then files against root', () => {
    const manifest = parseDatasetManifest(
      { version: 1, platform: 'xenium', root: '../data/', files: { cells: 'c.parquet' } },
      MANIFEST_URL,
    )
    expect(manifest.rootUrl).toBe('https://host.example/study/data')
    expect(manifest.files).toMatchObject({
      cells: { url: 'https://host.example/study/data/c.parquet' },
    })
  })

  it('drops the manifest URL query and fragment from the base', () => {
    const manifest = parseDatasetManifest(
      { version: 1, platform: 'xenium', files: { cells: 'c.parquet' } },
      'https://host.example/run/explorer.json?X-Amz-Signature=abc#frag',
    )
    expect(manifest.rootUrl).toBe('https://host.example/run')
    expect(manifest.files).toMatchObject({
      cells: { url: 'https://host.example/run/c.parquet' },
    })
  })

  it('protocol-relative path goes to another host', () => {
    const manifest = parseDatasetManifest(
      {
        version: 1,
        platform: 'xenium',
        files: { cells: '//other.example.org/c.parquet' },
      },
      MANIFEST_URL,
    )
    expect(manifest.files).toMatchObject({
      cells: { url: 'https://other.example.org/c.parquet' },
    })
  })

  it('h5ad image and labels resolve against root', () => {
    const manifest = parseDatasetManifest(
      {
        version: 1,
        platform: 'h5ad',
        root: 'https://spco.example/SPCOX/',
        files: { h5ad: 'a.zarr', image: 'a-raw.zarr', labels: 'a-label.zarr' },
        options: { coordinates: 'image-pixels' },
      },
      MANIFEST_URL,
    )
    expect(manifest.files).toMatchObject({
      h5ad: { url: 'https://spco.example/SPCOX/a.zarr' },
      image: { url: 'https://spco.example/SPCOX/a-raw.zarr' },
      labels: { url: 'https://spco.example/SPCOX/a-label.zarr' },
    })
  })

  it('collection entries resolve against root or the collection folder', () => {
    const collection = parseDatasetCollection(
      {
        version: 1,
        datasets: [
          { dataset: 's1.zarr', image: 'img/s1.zarr', coordinates: 'image-pixels' },
          { dataset: 'https://other.example/s2/explorer.json' },
        ],
      },
      COLLECTION_URL,
    )
    expect(collection.datasets[0]).toMatchObject({
      url: 'https://host.example/study/s1.zarr',
      image: {
        url: 'https://host.example/study/img/s1.zarr',
        coordinates: 'image-pixels',
      },
    })
    expect(collection.datasets[1].url).toBe('https://other.example/s2/explorer.json')
    const rooted = parseDatasetCollection(
      {
        version: 1,
        root: 'https://spco.example/SPCOX/',
        datasets: [{ dataset: 'a.zarr' }],
      },
      COLLECTION_URL,
    )
    expect(rooted.datasets[0].url).toBe('https://spco.example/SPCOX/a.zarr')
  })

  it('collection image default coordinates is micrometers', () => {
    const collection = parseDatasetCollection(
      { version: 1, datasets: [{ dataset: 'a', image: 'i.zarr' }] },
      COLLECTION_URL,
    )
    expect(collection.datasets[0].image?.coordinates).toBe('micrometers')
  })
})
