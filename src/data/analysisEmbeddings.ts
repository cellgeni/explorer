import { datasetFileUrl } from './datasetFiles'
import { notifyFallback, type FallbackNotifier } from './fallbackNotice'

export type AnalysisEmbeddingKind = 'umap' | 'tsne'
export type AnalysisEmbeddingElementLabel = 'cells' | 'bins'
export type AnalysisEmbeddingVisiumHdBinSize = 2 | 8 | 16

export interface AnalysisEmbeddingPoint {
  readonly id: string
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
  readonly visiumHdBinSizeMicrometers?: AnalysisEmbeddingVisiumHdBinSize
  readonly onFallback?: FallbackNotifier
}

export interface ParseAnalysisEmbeddingCsvOptions {
  readonly onFallback?: FallbackNotifier
  readonly sourcePath?: string
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
  const candidates = analysisEmbeddingCandidates(options.visiumHdBinSizeMicrometers)
  const embeddings: AnalysisEmbedding[] = []
  const loadedKinds = new Set<AnalysisEmbeddingKind>()
  const skippedPathsByKind = new Map<AnalysisEmbeddingKind, string[]>()

  for (const candidate of candidates) {
    if (loadedKinds.has(candidate.kind)) {
      continue
    }

    const csv = await fetchEmbeddingCsv(
      datasetFileUrl(baseUrl, candidate.path),
      fetcher,
      options.signal,
    )

    if (csv === null) {
      appendSkippedEmbeddingPath(skippedPathsByKind, candidate)
      continue
    }

    const points = parseAnalysisEmbeddingCsv(csv, candidate.kind, {
      sourcePath: candidate.path,
      ...(options.onFallback === undefined ? {} : { onFallback: options.onFallback }),
    })

    if (points.length === 0) {
      appendSkippedEmbeddingPath(skippedPathsByKind, candidate)
      continue
    }

    notifyEmbeddingPathFallback(
      options.onFallback,
      baseUrl,
      candidate,
      skippedPathsByKind.get(candidate.kind) ?? [],
    )
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
  options: ParseAnalysisEmbeddingCsvOptions = {},
): readonly AnalysisEmbeddingPoint[] {
  const rows = parseCsvRows(csv).filter((row) =>
    row.some((value) => value.trim().length > 0),
  )

  if (rows.length < 2) {
    return []
  }

  const header = rows[0] ?? []
  const idColumnIndex = findCellIdColumn(header)
  const xColumnIndex = findEmbeddingAxisColumn(header, kind, '1')
  const yColumnIndex = findEmbeddingAxisColumn(header, kind, '2')
  const idIndex = idColumnIndex ?? 0
  const xIndex = xColumnIndex ?? fallbackAxisIndex(1)
  const yIndex = yColumnIndex ?? fallbackAxisIndex(2)
  const points: AnalysisEmbeddingPoint[] = []
  const missingColumns = [
    ...(idColumnIndex === undefined ? ['cell id'] : []),
    ...(xColumnIndex === undefined ? [`${kind.toUpperCase()} x`] : []),
    ...(yColumnIndex === undefined ? [`${kind.toUpperCase()} y`] : []),
  ]

  if (missingColumns.length > 0) {
    notifyFallback(options.onFallback, {
      source: 'Analysis embeddings',
      message: `Projection CSV is missing recognized ${missingColumns.join(
        ', ',
      )} header${missingColumns.length === 1 ? '' : 's'}; using positional CSV columns instead.`,
      action:
        'The embedding can still load, but verify the projection if the CSV column order is custom.',
      ...(options.sourcePath === undefined ? {} : { detail: options.sourcePath }),
      coalesceKey: `analysis-embedding-columns:${kind}:${options.sourcePath ?? 'inline'}`,
    })
  }

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

    points.push({ id, x, y })
  }

  return points
}

function analysisEmbeddingCandidates(
  visiumHdBinSizeMicrometers: AnalysisEmbeddingVisiumHdBinSize | undefined,
): readonly EmbeddingCandidate[] {
  if (visiumHdBinSizeMicrometers === undefined) {
    return EMBEDDING_CANDIDATES
  }

  const binDirectory = `binned_outputs/square_${String(
    visiumHdBinSizeMicrometers,
  ).padStart(3, '0')}um`

  return [
    ...EMBEDDING_CANDIDATES.map((candidate) => ({
      ...candidate,
      path: `${binDirectory}/${candidate.path}`,
    })),
    ...EMBEDDING_CANDIDATES,
  ]
}

function appendSkippedEmbeddingPath(
  skippedPathsByKind: Map<AnalysisEmbeddingKind, string[]>,
  candidate: EmbeddingCandidate,
): void {
  skippedPathsByKind.set(candidate.kind, [
    ...(skippedPathsByKind.get(candidate.kind) ?? []),
    candidate.path,
  ])
}

function notifyEmbeddingPathFallback(
  onFallback: FallbackNotifier | undefined,
  baseUrl: string,
  candidate: EmbeddingCandidate,
  skippedPaths: readonly string[],
): void {
  if (skippedPaths.length === 0) {
    return
  }

  notifyFallback(onFallback, {
    source: 'Analysis embeddings',
    message: `${candidate.label} projection loaded from a secondary CSV path after earlier known paths were unavailable.`,
    action:
      'The embedding can still load, but the projection source may differ from the preferred Xenium output layout.',
    detail: `Using ${candidate.path}; skipped ${skippedPaths.join(', ')}`,
    coalesceKey: `analysis-embedding-path:${baseUrl}:${candidate.kind}`,
  })
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

function findCellIdColumn(header: readonly string[]): number | undefined {
  const index = header.findIndex((value) => {
    const normalized = normalizeHeader(value)

    return (
      normalized === 'barcode' ||
      normalized === 'cellid' ||
      normalized === 'cellbarcode' ||
      normalized === 'id'
    )
  })

  return index < 0 ? undefined : index
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
