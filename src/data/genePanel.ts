import { isGeneFeature } from './gex'
import { datasetFileUrl } from './datasetFiles'
import { notifyFallback, type FallbackNotifier } from './fallbackNotice'
import { loadTranscriptZarrGenePanel as loadTranscriptZarrGenePanelFromZip } from './transcriptZarr'

export interface LoadGenePanelOptions {
  readonly fetcher?: typeof fetch
  readonly loadTranscriptZarrGenePanel?: (
    url: string,
    options?: { readonly onFallback?: FallbackNotifier; readonly signal?: AbortSignal },
  ) => Promise<readonly string[]>
  readonly onFallback?: FallbackNotifier
  readonly signal?: AbortSignal
}

const GENE_NAME_KEYS = ['gene_name', 'gene', 'feature_name', 'symbol', 'target'] as const

const GENE_TYPE_KEYS = ['feature_type', 'type', 'category'] as const

export async function loadGenePanel(
  baseUrl: string,
  options: LoadGenePanelOptions = {},
): Promise<readonly string[]> {
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
  const url = datasetFileUrl(baseUrl, 'gene_panel.json')

  try {
    const response =
      options.signal === undefined
        ? await fetcher(url)
        : await fetcher(url, { signal: options.signal })

    if (!response.ok) {
      throw new Error(`Unable to load gene_panel.json: HTTP ${response.status}.`)
    }

    return parseGenePanel(await response.json())
  } catch (error) {
    if (isAbortError(error)) {
      throw error
    }

    notifyFallback(options.onFallback, {
      source: 'Gene panel',
      message:
        'gene_panel.json could not be loaded, so the app switched to transcript Zarr gene metadata.',
      action:
        'Gene search can continue if transcripts.zarr.zip exposes gene names, but panel-specific target metadata is unavailable.',
      detail: error instanceof Error ? error.message : String(error),
      coalesceKey: `gene-panel-transcript-zarr:${baseUrl}`,
    })
    return loadGenePanelFromTranscriptZarr(baseUrl, error, options)
  }
}

export function parseGenePanel(json: unknown): readonly string[] {
  const genes = new Set<string>()
  const targets = readTargetArray(json)

  for (const target of targets) {
    if (typeof target === 'string') {
      addGene(target, undefined, genes)
      continue
    }

    if (!isRecord(target)) {
      continue
    }

    const namedGene = readTargetGeneName(target)
    const featureType = readFirstStringProperty(target, GENE_TYPE_KEYS)

    if (namedGene !== undefined) {
      addGene(namedGene, featureType, genes)
    }
  }

  return [...genes].sort((a, b) => a.localeCompare(b))
}

function addGene(
  name: string,
  featureType: string | undefined,
  genes: Set<string>,
): void {
  const normalizedName = name.trim()

  if (normalizedName.length > 0 && isGeneFeature(normalizedName, featureType)) {
    genes.add(normalizedName)
  }
}

function readTargetArray(json: unknown): readonly unknown[] {
  const root = isRecord(json) ? json : {}
  const payload = readRecordProperty(root, 'payload')
  const panel = readRecordProperty(root, 'panel') ?? readRecordProperty(payload, 'panel')
  const targetCandidates = [
    root.targets,
    payload?.targets,
    panel?.targets,
    root.genes,
    payload?.genes,
    panel?.genes,
  ]

  for (const candidate of targetCandidates) {
    if (Array.isArray(candidate)) {
      return candidate
    }
  }

  return []
}

function readTargetGeneName(
  target: Readonly<Record<string, unknown>>,
): string | undefined {
  const directName = readFirstStringProperty(target, GENE_NAME_KEYS)

  if (directName !== undefined) {
    return directName
  }

  const type = readRecordProperty(target, 'type')
  const data = readRecordProperty(type, 'data')
  const descriptor = type?.descriptor
  const nestedName = data?.name

  if (
    typeof descriptor === 'string' &&
    descriptor.toLowerCase() === 'gene' &&
    typeof nestedName === 'string'
  ) {
    return nestedName
  }

  return undefined
}

function readRecordProperty(
  value: Readonly<Record<string, unknown>> | undefined,
  key: string,
): Readonly<Record<string, unknown>> | undefined {
  if (value === undefined) {
    return undefined
  }

  const property = value[key]

  return isRecord(property) ? property : undefined
}

function readFirstStringProperty(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const candidate = value[key]

    if (typeof candidate === 'string') {
      return candidate
    }
  }

  return undefined
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null
}

async function loadGenePanelFromTranscriptZarr(
  baseUrl: string,
  genePanelError: unknown,
  options: LoadGenePanelOptions,
): Promise<readonly string[]> {
  const loader = options.loadTranscriptZarrGenePanel ?? loadTranscriptZarrGenePanelFromZip
  const url = datasetFileUrl(baseUrl, 'transcripts.zarr.zip')
  const loaderOptions =
    options.signal === undefined && options.onFallback === undefined
      ? undefined
      : {
          ...(options.onFallback === undefined ? {} : { onFallback: options.onFallback }),
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        }

  try {
    return await loader(url, loaderOptions)
  } catch (transcriptZarrError) {
    if (isAbortError(transcriptZarrError)) {
      throw transcriptZarrError
    }

    throw new Error(
      `Unable to load gene panel from gene_panel.json (${errorMessage(
        genePanelError,
      )}) or transcripts.zarr.zip (${errorMessage(transcriptZarrError)}).`,
      { cause: transcriptZarrError },
    )
  }
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'AbortError'
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
