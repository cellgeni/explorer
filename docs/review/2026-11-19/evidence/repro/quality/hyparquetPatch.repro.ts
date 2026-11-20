// Is patches/hyparquet+1.26.0.patch still needed, and does the regression
// input (src/data/hyparquetBitPacked.test.ts) reach the patched branch?
// Builds the upstream 1.26.0 readBitPacked loop from the installed (patched)
// file by undoing the one-line patch in a temporary copy, then decodes the
// same truncated Polars-style run with both. Expected values come from the
// input array, not from hyparquet.
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const SRC = join(process.cwd(), 'node_modules/hyparquet/src')
const PATCHED_LOOP = 'while (count && seen < output.length) {'
const UPSTREAM_LOOP = 'while (count) {'

type Hybrid = (
  reader: { view: DataView; offset: number },
  width: number,
  output: number[],
  length?: number,
) => void

function packBits(values: readonly number[], width: number): Uint8Array {
  const bytes = new Uint8Array(Math.ceil((values.length * width) / 8))
  values.forEach((value, index) => {
    for (let bit = 0; bit < width; bit++) {
      if ((value >> bit) & 1) {
        const position = index * width + bit
        bytes[position >> 3]! |= 1 << (position & 7)
      }
    }
  })
  return bytes
}

// A temporary copy beside this file (vite-node will not import from /tmp),
// removed after the run.
const tempDirs: string[] = []
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

async function loadUpstream(): Promise<Hybrid> {
  const dir = mkdtempSync(join(import.meta.dirname, '.upstream-'))
  tempDirs.push(dir)
  const patched = readFileSync(join(SRC, 'encoding.js'), 'utf8')
  const upstream = patched.replace(PATCHED_LOOP, UPSTREAM_LOOP)
  writeFileSync(join(dir, 'encoding.js'), upstream)
  copyFileSync(join(SRC, 'thrift.js'), join(dir, 'thrift.js'))
  const module = (await import(/* @vite-ignore */ join(dir, 'encoding.js'))) as {
    readRleBitPackedHybrid: Hybrid
  }
  return module.readRleBitPackedHybrid
}

// Nine 3-bit values: one full group of 8 and a last group holding one value,
// truncated to ceil(9*3/8) = 4 bytes as Polars writes it.
const values = [1, 2, 3, 4, 5, 6, 7, 0, 5]
const width = 3
const truncatedRun = () =>
  new Uint8Array([(Math.ceil(values.length / 8) << 1) | 1, ...packBits(values, width)])

describe('hyparquet 1.26.0 patch', () => {
  it('is applied in node_modules', () => {
    const source = readFileSync(join(SRC, 'encoding.js'), 'utf8')
    const version = JSON.parse(readFileSync(join(SRC, '..', 'package.json'), 'utf8')) as {
      version: string
    }
    expect(version.version).toBe('1.26.0')
    expect(source).toContain(PATCHED_LOOP)
  })

  it('upstream 1.26.0 throws on a truncated last bit-packed group', async () => {
    const upstream = await loadUpstream()
    const run = truncatedRun()
    const reader = { view: new DataView(run.buffer), offset: 0 }
    const output = new Array<number>(values.length)
    expect(() => upstream(reader, width, output, run.byteLength)).toThrow(RangeError)
  })

  it('patched 1.26.0 decodes it, and resets the offset from the length', async () => {
    const { readRleBitPackedHybrid } =
      (await import('hyparquet/src/encoding.js')) as unknown as {
        readRleBitPackedHybrid: Hybrid
      }
    const run = truncatedRun()
    const reader = { view: new DataView(run.buffer), offset: 0 }
    const output = new Array<number>(values.length)
    readRleBitPackedHybrid(reader, width, output, run.byteLength)
    expect(output).toEqual(values)
    expect(reader.offset).toBe(run.byteLength)
  })

  it('upstream and patched agree on a padded last group', async () => {
    const upstream = await loadUpstream()
    const { readRleBitPackedHybrid } =
      (await import('hyparquet/src/encoding.js')) as unknown as {
        readRleBitPackedHybrid: Hybrid
      }
    const padded = [...values, ...new Array<number>(7).fill(0)]
    const run = new Uint8Array([(2 << 1) | 1, ...packBits(padded, width)])
    for (const decode of [upstream, readRleBitPackedHybrid]) {
      const reader = { view: new DataView(run.buffer), offset: 0 }
      const output = new Array<number>(values.length)
      decode(reader, width, output, run.byteLength)
      expect(output).toEqual(values)
      expect(reader.offset).toBe(run.byteLength)
    }
  })
})
