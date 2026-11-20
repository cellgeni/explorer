// MERSCOPE CSV size limit with gzipped files (review 2026-11-19).
// docs/modalities/merscope.md "Files Read": "A Content-Length above 300 MB,
// or a gzipped file that inflates past it, fails the load with the file's
// size." The expected message below is written from that sentence and
// MerscopeCsvTooLargeError's template, not computed by production code.
//   npx vitest run --config docs/review/2026-11-19/evidence/repro/vitest.repro.config.ts \
//     docs/review/2026-11-19/evidence/repro/platforms/merscope-size-limit.repro.ts
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { readMerscopeTable } from '../../../../../../src/datasets/merscopeTableReader'

const ROOT = 'https://example.test/region'
const MB = 1024 * 1024

// A dense cell_by_gene.csv of `byteLength` bytes, gzipped; the
// metadata is tiny. Returns the gzip bytes.
function gzippedDenseCsv(byteLength: number): Uint8Array {
  const header = 'cell,G1,G2,G3,G4,G5,G6,G7,G8,G9\n'
  const row = '1577590100000000000,0,0,0,0,0,0,0,0,0\n'
  const text = Buffer.alloc(byteLength, row)
  text.write(header, 0)
  // Keep the file a whole number of rows after the header.
  return new Uint8Array(gzipSync(text, { level: 1 }))
}

function fetcherFor(gzip: Uint8Array): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input)

    if (url.endsWith('cell_by_gene.csv.gz')) {
      return new Response(gzip.slice(), {
        headers: { 'Content-Length': String(gzip.byteLength) },
      })
    }

    const metadata = new TextEncoder().encode('EntityID,center_x,center_y\n1,1,1\n')
    return new Response(metadata, {
      headers: { 'Content-Length': String(metadata.byteLength) },
    })
  }) as typeof fetch
}

async function outcome(byteLength: number): Promise<string> {
  const gzip = gzippedDenseCsv(byteLength)
  console.log(
    `[size] inflated ${(byteLength / MB).toFixed(1)} MB, gzip ${(gzip.byteLength / MB).toFixed(2)} MB`,
  )
  const started = performance.now()

  try {
    await readMerscopeTable({
      files: {
        cellByGene: `${ROOT}/cell_by_gene.csv.gz`,
        cellMetadata: `${ROOT}/cell_metadata.csv`,
      },
      fetcher: fetcherFor(gzip),
    })
    return 'loaded'
  } catch (error) {
    const result = `${(error as Error).name}: ${(error as Error).message}`
    console.log(
      `[size] ${result} (after ${((performance.now() - started) / 1000).toFixed(1)} s)`,
    )
    return result
  }
}

describe('MERSCOPE gzipped CSV above the 300 MB limit', () => {
  it('310 MB inflated: the documented limit message', async () => {
    expect(await outcome(310 * MB)).toBe(
      'MerscopeCsvTooLargeError: cell_by_gene.csv.gz is 310.0 MB, above the 300.0 MB browser load limit.',
    )
  }, 180_000)

  it('520 MiB inflated (past the engine string limit 0x1fffffe8): the same message expected', async () => {
    expect(await outcome(520 * MB)).toBe(
      'MerscopeCsvTooLargeError: cell_by_gene.csv.gz is 520.0 MB, above the 300.0 MB browser load limit.',
    )
  }, 300_000)
})
