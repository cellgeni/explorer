// Addendum, review 2026-11-20: a table split into sections when it has both
// an obs depth column (`z_um`) and a third obsm `spatial` column that varies
// within a section, as when each cell keeps its own z in the table's frame.
// The split takes each section's z from z_um, the section's cells keep their
// own z (it varies), and the stack draws each cell at section z + cell z.
// The table is an in-memory AnnData (memorySource); the placement uses the
// stack's own model matrix and depth range.
//
//   npx vitest run --config docs/review/2026-11-19/evidence/repro/vitest.repro.config.ts \
//     docs/review/2026-11-19/evidence/repro/addendum/sections-depth-twice.repro.ts
//
// Each `it` asserts what main at 5b1cd9f actually does; the comment above it
// says which contract that breaks.
import { describe, expect, it } from 'vitest'
import { loadDatasetCollection } from '../../../../../../src/datasets/annDataSectionCollection'
import {
  AnnDataH5adDataset,
  type AnnDataMemoryTable,
} from '../../../../../../src/datasets/h5adDataset'
import {
  sectionModelMatrix,
  stackDepths,
  stackFrame,
  type StackSection,
} from '../../../../../../src/features/collection/sectionStackModel'
import type { PreviewEntry } from '../../../../../../src/features/collection/collectionPreviewStore'

const FILE = 'https://example.test/aligned.h5ad'
// Two sections 100 µm apart. Each cell's z in the table's frame (obsm
// spatial column 2) is within 2 µm of its section's z_um.
const SECTION = [0, 0, 0, 1, 1, 1]
const Z_UM = [0, 0, 0, 100, 100, 100]
const CELL_Z = [0, 1, 2, 100, 101, 102]

const table: AnnDataMemoryTable = {
  obsNames: ['a', 'b', 'c', 'd', 'e', 'f'],
  obs: [
    { name: 'section', kind: 'categorical', codes: SECTION, categories: ['s1', 's2'] },
    { name: 'z_um', kind: 'numeric', values: Float64Array.from(Z_UM) },
  ],
  varNames: ['g1'],
  X: {
    kind: 'csr',
    data: new Float32Array(6).fill(1),
    indices: new Int32Array(6),
    indptr: Int32Array.from([0, 1, 2, 3, 4, 5, 6]),
  },
  obsm: {
    spatial: {
      values: Float64Array.from(
        CELL_Z.flatMap((z, row) => [row % 3, Math.floor(row / 3), z]),
      ),
      columns: 3,
    },
  },
}

function openFile(): AnnDataH5adDataset {
  return new AnnDataH5adDataset({
    url: FILE,
    memorySource: { label: 'aligned.h5ad', load: async () => table },
  })
}

function openSection(file: AnnDataH5adDataset, value: string): AnnDataH5adDataset {
  return new AnnDataH5adDataset({
    url: `${FILE}#obs.section=${value}`,
    section: {
      column: 'section',
      value,
      holdFile: () => ({ dataset: Promise.resolve(file), release: () => undefined }),
    },
  })
}

// Where the stack draws a cell: the model matrix applied to (x, -y, z), at
// depth stretch 1, relative to the frame's centre.
function drawnZ(matrix: Float32Array, cellZ: number): number {
  return (matrix[10] ?? 0) * cellZ + (matrix[14] ?? 0)
}

describe('sections of one table: obs z_um and a per-cell third obsm column', () => {
  it('the whole table in the 3D cell view: cells at their own z (control)', async () => {
    const z = (await openFile().overview()).map((point) => point.z)
    expect(z).toEqual(CELL_Z)
  })

  // docs/dataset-collections.md (Sections Of One Table, Registered): the
  // sections share the table's coordinates, so a cell should keep the z it
  // has in the table (0-2 and 100-102 µm here). The split gives each section
  // z = z_um, its cells keep their table z, and the stack adds the two:
  // section s2 is drawn at 200-202 µm and the stack spans 0-202 µm.
  it('the split stack draws section s2 at z_um + cell z', async () => {
    const file = openFile()
    const collection = await loadDatasetCollection(FILE, {
      openDataset: async () => file,
    })
    expect(collection.datasets.map((entry) => [entry.name, entry.z])).toEqual([
      ['s1', 0],
      ['s2', 100],
    ])

    const sections: StackSection[] = collection.datasets.map((entry) => ({
      entry,
      z: entry.z ?? 0,
    }))
    const cellDepths = await Promise.all(
      ['s1', 's2'].map(async (value) =>
        (await openSection(file, value).overview()).map((point) => point.z),
      ),
    )
    // Each section keeps its cells' table z, since it varies within it.
    expect(cellDepths).toEqual([
      [0, 1, 2],
      [100, 101, 102],
    ])

    // The previews' depth ranges, as previewDepths gives them.
    const previews = cellDepths.map(
      (depths) =>
        ({
          cells: {
            depths: {
              values: Float32Array.from(depths as number[]),
              min: Math.min(...(depths as number[])),
              max: Math.max(...(depths as number[])),
            },
          },
        }) as unknown as PreviewEntry,
    )
    expect(stackDepths(sections, previews)).toEqual([0, 2, 200, 202])

    const frame = stackFrame([0], [{ minX: 0, maxX: 2, minY: 0, maxY: 1 }])
    if (frame === null) throw new Error('no frame')
    const drawn = sections.map((section, index) =>
      (cellDepths[index] as number[]).map((z) =>
        drawnZ(sectionModelMatrix(frame, section.z, 1), z),
      ),
    )
    expect(drawn).toEqual([
      [0, 1, 2],
      [200, 201, 202],
    ])
  })
})
