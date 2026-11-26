import {
  formatReadSize,
  PLOT_READ_MAX_BYTES,
  plotReadDecision,
} from '../features/plots/plotsPanelModel'
import {
  geneValuesRowIdAt,
  isGeneValuesError,
  type GeneValues,
  type GeneValuesRowIds,
  type GeneValuesSource,
} from './geneValues'
import { throwIfAborted } from '../utils/abort'

// A gene's value in every cell on the canvas, by overview row, for the
// Python console's `cells.gene` (plan 29). The matrix's rows are joined to
// the overview's once, by cell ID; each read then places the gene's stored
// values. A cell the matrix has with nothing stored is 0; a cell the matrix
// does not list is NaN. Reads keep to the Plots panel's budget.

export interface GeneRowReadOptions {
  // A matrix other than the one Plots reads (see `GeneValuesSource`).
  readonly layer?: string | undefined
  // Reads between the prompt size and the limit; Plots asks first.
  readonly allowLarge?: boolean
  readonly signal?: AbortSignal | undefined
}

// A read over the prompt size, which `allowLarge` allows.
export class GeneReadTooLarge extends Error {
  readonly bytes: number

  constructor(gene: string, layer: string | undefined, bytes: number) {
    super(
      `Reading ${gene}${layerPhrase(layer)} would read about ${formatReadSize(bytes)}. Call ${allowLargeCall(gene, layer)} to read it anyway.`,
    )
    this.name = 'GeneReadTooLarge'
    this.bytes = bytes
  }
}

// A read over the limit, which nothing allows.
export class GeneReadRefused extends Error {
  readonly bytes: number

  constructor(gene: string, layer: string | undefined, bytes: number) {
    super(
      `Reading ${gene}${layerPhrase(layer)} would read about ${formatReadSize(bytes)}, over the ${formatReadSize(PLOT_READ_MAX_BYTES)} limit Plots also keeps.`,
    )
    this.name = 'GeneReadRefused'
    this.bytes = bytes
  }
}

export class GeneRowReader {
  private readonly source: GeneValuesSource
  private readonly overviewIds: readonly string[]
  private joinPromise: Promise<GeneRowJoin> | null = null

  constructor(source: GeneValuesSource, overviewIds: readonly string[]) {
    this.source = source
    this.overviewIds = overviewIds
  }

  // One float32 per overview row.
  async read(gene: string, options: GeneRowReadOptions = {}): Promise<Float32Array> {
    const { layer, signal } = options
    const estimate = await this.source.estimateGeneValuesRead([gene], { layer })
    throwIfAborted(signal)

    if (estimate.kind === 'unavailable') throw new Error(estimate.reason)

    const decision = plotReadDecision(
      estimate.bytes,
      options.allowLarge === true ? Number.POSITIVE_INFINITY : 0,
    )

    if (decision === 'refuse') throw new GeneReadRefused(gene, layer, estimate.bytes)
    if (decision === 'ask') throw new GeneReadTooLarge(gene, layer, estimate.bytes)

    const [join, [read]] = await Promise.all([
      this.join(),
      this.source.geneValues([gene], { signal, layer }),
    ])
    throwIfAborted(signal)

    if (read === undefined) throw new Error(`${gene} was not read.`)
    if (isGeneValuesError(read)) throw new Error(read.error)

    return overviewGeneValues(join, read)
  }

  // The matrices besides the default the source offers; none for most.
  async layers(): Promise<readonly string[]> {
    return (await this.source.geneValuesLayers?.()) ?? []
  }

  private join(): Promise<GeneRowJoin> {
    if (this.joinPromise === null) {
      this.joinPromise = this.source
        .geneValuesRowIds()
        .then((rowIds) => joinGeneRowsToOverview(rowIds, this.overviewIds))
        .catch((error: unknown) => {
          this.joinPromise = null
          throw error
        })
    }

    return this.joinPromise
  }
}

export interface GeneRowJoin {
  // Each matrix row's overview row, or -1 for a cell not on the overview.
  readonly overviewRowByMatrixRow: Int32Array
  // Each overview row before any values: 0 for a cell the matrix lists, NaN
  // for one it does not.
  readonly empty: Float32Array
}

// The matrix's rows joined to the overview's by cell ID. An ID listed twice
// joins its first row on each side.
export function joinGeneRowsToOverview(
  rowIds: GeneValuesRowIds,
  overviewIds: readonly string[],
): GeneRowJoin {
  const overviewRowById = new Map<string, number>()

  overviewIds.forEach((id, row) => {
    if (!overviewRowById.has(id)) overviewRowById.set(id, row)
  })

  const { count, idAt } = geneValuesRowIdAt(rowIds)
  const overviewRowByMatrixRow = new Int32Array(count)
  const empty = new Float32Array(overviewIds.length).fill(Number.NaN)

  for (let row = 0; row < count; row += 1) {
    const overviewRow = overviewRowById.get(idAt(row)) ?? -1

    // A later matrix row for the same cell is left out.
    if (overviewRow >= 0 && empty[overviewRow] === 0) {
      overviewRowByMatrixRow[row] = -1
      continue
    }

    overviewRowByMatrixRow[row] = overviewRow
    if (overviewRow >= 0) empty[overviewRow] = 0
  }

  return { overviewRowByMatrixRow, empty }
}

// A gene's stored values placed on the overview's rows.
export function overviewGeneValues(
  join: GeneRowJoin,
  column: Pick<GeneValues, 'rows' | 'values'>,
): Float32Array {
  const values = join.empty.slice()
  const { overviewRowByMatrixRow } = join

  column.rows.forEach((row, index) => {
    const overviewRow = overviewRowByMatrixRow[row] ?? -1
    if (overviewRow >= 0) values[overviewRow] = column.values[index] ?? 0
  })

  return values
}

function layerPhrase(layer: string | undefined): string {
  return layer === undefined ? '' : ` from layer "${layer}"`
}

// The console call that reads the gene anyway.
function allowLargeCall(gene: string, layer: string | undefined): string {
  const layerArg = layer === undefined ? '' : `, layer=${JSON.stringify(layer)}`
  return `cells.gene(${JSON.stringify(gene)}${layerArg}, allow_large=True)`
}
