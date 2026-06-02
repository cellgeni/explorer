import { datasetFileUrl } from './datasetFiles'
import type { CellId } from './cellid'

export type AnalysisEmbeddingKind = 'umap' | 'tsne'

export interface AnalysisEmbeddingPoint {
  readonly id: CellId
  readonly x: number
  readonly y: number
}

export interface AnalysisEmbedding {
  readonly kind: AnalysisEmbeddingKind
  readonly label: string
  readonly sourcePath: string
  readonly points: readonly AnalysisEmbeddingPoint[]
}

export interface LoadDatasetAnalysisEmbeddingsOptions {
  readonly signal?: AbortSignal
  readonly fetcher?: typeof fetch
}

interface EmbeddingCandidate {
  readonly kind: AnalysisEmbeddingKind
  readonly label: string
  readonly path: string
}

const EMBEDDING_CANDIDATES: readonly EmbeddingCandidate[] = [
  {
    kind: 'umap',
    label: 'UMAP',
    path: 'analysis/umap/gene_expression_2_components/projection.csv',
  },
  {
    kind: 'umap',
    label: 'UMAP',
    path: 'analysis/umap/2_components/projection.csv',
  },
  {
    kind: 'umap',
    label: 'UMAP',
    path: 'analysis/umap/projection.csv',
  },
  {
    kind: 'tsne',
    label: 't-SNE',
    path: 'analysis/tsne/gene_expression_2_components/projection.csv',
  },
  {
    kind: 'tsne',
    label: 't-SNE',
    path: 'analysis/tsne/2_components/projection.csv',
  },
  {
    kind: 'tsne',
    label: 't-SNE',
    path: 'analysis/tsne/projection.csv',
  },
]

export async function loadDatasetAnalysisEmbeddings(
  baseUrl: string,
  options: LoadDatasetAnalysisEmbeddingsOptions = {},
): Promise<readonly AnalysisEmbedding[]> {
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
  const embeddings: AnalysisEmbedding[] = []
  const loadedKinds = new Set<AnalysisEmbeddingKind>()

  for (const candidate of EMBEDDING_CANDIDATES) {
    if (loadedKinds.has(candidate.kind)) {
      continue
    }

    const csv = await fetchEmbeddingCsv(
      datasetFileUrl(baseUrl, candidate.path),
      fetcher,
      options.signal,
    )

    if (csv === null) {
      continue
    }

    const points = parseAnalysisEmbeddingCsv(csv, candidate.kind)

    if (points.length === 0) {
      continue
    }

    embeddings.push({
      kind: candidate.kind,
      label: candidate.label,
      sourcePath: candidate.path,
      points,
    })
    loadedKinds.add(candidate.kind)
  }

  return embeddings
}

export function parseAnalysisEmbeddingCsv(
  csv: string,
  kind: AnalysisEmbeddingKind,
): readonly AnalysisEmbeddingPoint[] {
  const rows = parseCsvRows(csv).filter((row) =>
    row.some((value) => value.trim().length > 0),
  )

  if (rows.length < 2) {
    return []
  }

  const header = rows[0] ?? []
  const idIndex = findCellIdColumn(header)
  const xIndex = findEmbeddingAxisColumn(header, kind, '1') ?? fallbackAxisIndex(1)
  const yIndex = findEmbeddingAxisColumn(header, kind, '2') ?? fallbackAxisIndex(2)
  const points: AnalysisEmbeddingPoint[] = []

  for (const row of rows.slice(1)) {
    const id = row[idIndex]?.trim()
    const x = Number(row[xIndex])
    const y = Number(row[yIndex])

    if (
      id === undefined ||
      id.length === 0 ||
      !Number.isFinite(x) ||
      !Number.isFinite(y)
    ) {
      continue
    }

    points.push({ id: id as CellId, x, y })
  }

  return points
}

async function fetchEmbeddingCsv(
  url: string,
  fetcher: typeof fetch,
  signal: AbortSignal | undefined,
): Promise<string | null> {
  const response = await fetcher(url, signal === undefined ? undefined : { signal })

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    return null
  }

  return response.text()
}

function findCellIdColumn(header: readonly string[]): number {
  const index = header.findIndex((value) => {
    const normalized = normalizeHeader(value)

    return (
      normalized === 'barcode' ||
      normalized === 'cellid' ||
      normalized === 'cellbarcode' ||
      normalized === 'id'
    )
  })

  return index < 0 ? 0 : index
}

function findEmbeddingAxisColumn(
  header: readonly string[],
  kind: AnalysisEmbeddingKind,
  axis: '1' | '2',
): number | undefined {
  const kindPrefix = kind === 'umap' ? 'umap' : 'tsne'
  const index = header.findIndex((value) => {
    const normalized = normalizeHeader(value)

    return (
      normalized === `${kindPrefix}${axis}` ||
      normalized === `${kindPrefix}${axis === '1' ? 'x' : 'y'}` ||
      normalized === `${axis === '1' ? 'x' : 'y'}${kindPrefix}`
    )
  })

  return index < 0 ? undefined : index
}

function fallbackAxisIndex(index: number): number {
  return index
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function parseCsvRows(csv: string): readonly (readonly string[])[] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index]

    if (character === '"') {
      if (inQuotes && csv[index + 1] === '"') {
        field += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (character === ',' && !inQuotes) {
      row.push(field)
      field = ''
      continue
    }

    if ((character === '\n' || character === '\r') && !inQuotes) {
      if (character === '\r' && csv[index + 1] === '\n') {
        index += 1
      }

      row.push(field)
      rows.push(row)
      row = []
      field = ''
      continue
    }

    field += character ?? ''
  }

  row.push(field)
  rows.push(row)

  return rows
}
