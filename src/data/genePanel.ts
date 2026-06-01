import { isGeneFeature } from './gex'
import { datasetFileUrl } from './datasetFiles'

export interface LoadGenePanelOptions {
  readonly fetcher?: typeof fetch
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
  const response =
    options.signal === undefined
      ? await fetcher(url)
      : await fetcher(url, { signal: options.signal })

  if (!response.ok) {
    throw new Error(`Unable to load gene_panel.json: HTTP ${response.status}.`)
  }

  return parseGenePanel(await response.json())
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
