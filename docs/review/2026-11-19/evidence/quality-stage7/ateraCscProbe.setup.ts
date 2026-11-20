// Review-only probe: logs why AteraDataset.readCsc rejects, so the existing
// test "rejects a CSC matrix whose feature count differs from the matrix"
// (src/datasets/ateraDataset.test.ts:530) can be checked without editing it.
import { AteraDataset } from '../../../../../src/datasets/ateraDataset'

const proto = AteraDataset.prototype as unknown as Record<
  string,
  (...args: unknown[]) => Promise<unknown>
>
for (const name of ['geneExpression', 'readCsc', 'genes']) {
  const original = proto[name]
  if (original === undefined) {
    console.log(`no ${name} on the prototype`)
    continue
  }
  proto[name] = async function (this: unknown, ...args: unknown[]) {
    try {
      return await original.apply(this, args)
    } catch (error) {
      const e = error as Error
      console.log(`${name} rejected: ${e.name}: ${e.message}`)
      throw error
    }
  }
}
