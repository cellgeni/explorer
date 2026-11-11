import { DEMO_DATASET_URL } from '../../store/viewerStore'

// The example gallery (UNIFIED_PLAN.md, 15.3-A, D9). The index is read from
// GitHub at runtime, so new examples appear without a release; a build can
// point it elsewhere with VITE_EXAMPLES_INDEX_URL.

export const DEFAULT_EXAMPLES_INDEX_URL =
  'https://raw.githubusercontent.com/cellgeni/explorer/main/examples/index.json'

export const EXAMPLES_INDEX_URL = examplesIndexUrl(
  import.meta.env.VITE_EXAMPLES_INDEX_URL,
)

export const EXAMPLES_FETCH_TIMEOUT_MS = 5_000

// A gallery holds no more than this, whatever the index lists.
const MAX_EXAMPLES = 48

export interface ExampleSource {
  readonly repository?: string
  readonly accession?: string
  // Only http(s), since it becomes a link.
  readonly url?: string
  readonly license?: string
}

export interface Example {
  readonly id: string
  readonly name: string
  readonly manifestUrl: string
  readonly platform?: string
  readonly description?: string
  readonly source?: ExampleSource
}

// Offered when the index cannot be read, so the start screen is never empty.
export const DEMO_EXAMPLE: Example = {
  id: 'demo',
  name: 'Human brain (Xenium 5K demo)',
  manifestUrl: DEMO_DATASET_URL,
  platform: 'xenium',
  description:
    '1,414,155 cells and 5,001 genes, with transcripts, cell boundaries and the morphology image.',
  source: { repository: 'Wellcome Sanger Institute' },
}

export class ExamplesIndexError extends Error {
  override readonly name = 'ExamplesIndexError'
}

export function examplesIndexUrl(configured: string | undefined): string {
  const url = configured?.trim()
  return url === undefined || url === '' ? DEFAULT_EXAMPLES_INDEX_URL : url
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function parseSource(value: unknown): ExampleSource | undefined {
  if (!isRecord(value)) return undefined

  const repository = text(value.repository)
  const accession = text(value.accession)
  const url = text(value.url)
  const license = text(value.license)
  const source: ExampleSource = {
    ...(repository === undefined ? {} : { repository }),
    ...(accession === undefined ? {} : { accession }),
    ...(url === undefined || !isHttpUrl(url) ? {} : { url }),
    ...(license === undefined ? {} : { license }),
  }

  return Object.keys(source).length === 0 ? undefined : source
}

function parseExample(value: unknown): Example | null {
  if (!isRecord(value)) return null

  const id = text(value.id)
  const name = text(value.name)
  const manifestUrl = text(value.manifestUrl)

  if (
    id === undefined ||
    name === undefined ||
    manifestUrl === undefined ||
    !isHttpUrl(manifestUrl)
  ) {
    return null
  }

  const platform = text(value.platform)
  const description = text(value.description)
  const source = parseSource(value.source)

  return {
    id,
    name,
    manifestUrl,
    ...(platform === undefined ? {} : { platform }),
    ...(description === undefined ? {} : { description }),
    ...(source === undefined ? {} : { source }),
  }
}

// Reads `examples/index.json` version 1. Entries without an id, a name or an
// http(s) manifest URL are skipped, and unknown fields are ignored. Only text
// is kept; the gallery renders it as text, never as HTML.
export function parseExamplesIndex(value: unknown): readonly Example[] {
  if (!isRecord(value) || value.version !== 1) {
    throw new ExamplesIndexError('The examples index is not version 1.')
  }

  if (!Array.isArray(value.examples)) {
    throw new ExamplesIndexError('The examples index has no examples list.')
  }

  const examples: Example[] = []
  const ids = new Set<string>()

  for (const entry of value.examples) {
    const example = parseExample(entry)
    if (example === null || ids.has(example.id)) continue
    ids.add(example.id)
    examples.push(example)
    if (examples.length === MAX_EXAMPLES) break
  }

  return examples
}

export interface FetchExamplesIndexOptions {
  readonly fetchImpl?: typeof fetch
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
}

// Fetches and parses the index, giving up after `timeoutMs`.
export async function fetchExamplesIndex(
  url: string,
  {
    fetchImpl = fetch,
    signal,
    timeoutMs = EXAMPLES_FETCH_TIMEOUT_MS,
  }: FetchExamplesIndexOptions = {},
): Promise<readonly Example[]> {
  const controller = new AbortController()
  const abort = () => {
    controller.abort()
  }
  const timeout = setTimeout(abort, timeoutMs)
  signal?.addEventListener('abort', abort, { once: true })

  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      cache: 'no-cache',
    })

    if (!response.ok) {
      throw new ExamplesIndexError(`The examples index answered HTTP ${response.status}.`)
    }

    return parseExamplesIndex(await response.json())
  } catch (error) {
    if (controller.signal.aborted && signal?.aborted !== true) {
      throw new ExamplesIndexError(
        `The examples index did not answer within ${(timeoutMs / 1000).toLocaleString()} s.`,
      )
    }
    throw error
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
  }
}

const CACHE_KEY_PREFIX = 'explorer.examples:'

// The index is kept for the session, so reopening the start screen or the
// dataset menu does not fetch it again. Storage can be missing or refuse
// (private windows, blocked site data), which only means no cache.
export function readCachedExamples(
  storage: Pick<Storage, 'getItem'> | null,
  url: string,
): readonly Example[] | null {
  try {
    const raw = storage?.getItem(`${CACHE_KEY_PREFIX}${url}`)
    if (raw === null || raw === undefined) return null
    return parseExamplesIndex(JSON.parse(raw))
  } catch {
    return null
  }
}

export function writeCachedExamples(
  storage: Pick<Storage, 'setItem'> | null,
  url: string,
  examples: readonly Example[],
): void {
  try {
    storage?.setItem(
      `${CACHE_KEY_PREFIX}${url}`,
      JSON.stringify({ version: 1, examples }),
    )
  } catch {
    // No cache this session.
  }
}

export function clearCachedExamples(
  storage: Pick<Storage, 'removeItem'> | null,
  url: string,
): void {
  try {
    storage?.removeItem(`${CACHE_KEY_PREFIX}${url}`)
  } catch {
    // Nothing to clear.
  }
}

// window.sessionStorage, or null where reading it throws.
export function sessionStorageOrNull(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}
