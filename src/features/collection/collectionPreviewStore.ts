import type { GeneExpressionScoreMode } from '../../rendering/deckLayerTypes'
import { colorsForAnnotations } from '../annotations/annotationModel'
import {
  openPreviewSource,
  PreviewUnavailableError,
  type CollectionPreviewLoaders,
  type PreviewCells,
  type PreviewClasses,
  type PreviewScores,
  type PreviewSource,
} from './collectionPreviewData'

// The previews of a collection's datasets. Each dataset's cell positions are
// read once; the scores for the selected genes, or the classes of the
// selected annotation set, are read again when the selection changes. Only
// datasets in view in the bar, and those shown side by side, are read, a few
// at a time, the side by side ones first; none start while the main view
// loads a dataset.

export interface PreviewEntry {
  readonly cells: PreviewCells | null
  // For the current genes; null without genes, or until read.
  readonly scores: PreviewScores | null
  // For the current annotation set; null without one, or until read.
  readonly classes: PreviewClasses | null
  readonly loading: boolean
  // Why there is no preview, such as an image without cells.
  readonly unavailable: string | null
  readonly error: string | null
}

// Cells are coloured by an annotation set when one is given, otherwise by
// the genes; with neither, the previews show the cells only.
export interface PreviewRequest {
  readonly genes: readonly string[]
  readonly scoreMode: GeneExpressionScoreMode
  readonly annotationGroupId: string | null
}

export const PREVIEW_CONCURRENCY = 4

const EMPTY_ENTRY: PreviewEntry = {
  cells: null,
  scores: null,
  classes: null,
  loading: false,
  unavailable: null,
  error: null,
}

export class CollectionPreviewStore {
  private readonly urls: readonly string[]
  private readonly loaders: CollectionPreviewLoaders
  private readonly concurrency: number
  // The datasets are open in the main view: see openPreviewSource.
  private readonly open: boolean
  private readonly sources = new Map<string, Promise<PreviewSource>>()
  private readonly cells = new Map<string, PreviewCells>()
  private readonly unavailable = new Map<string, string>()
  private readonly errors = new Map<string, string>()
  private readonly running = new Map<string, AbortController>()
  private readonly visible = new Set<string>()
  // Shown side by side with the main view, so read whether in the bar or not.
  private linked: readonly string[] = []
  private readonly listeners = new Set<() => void>()
  // Cell positions do not depend on the genes, so only stopping stops them.
  private lifetime = new AbortController()
  // Scores for the genes and score mode in scoresKey, and classes of the set
  // classesGroupId: kept while a request asks for neither.
  private scores = new Map<string, PreviewScores>()
  private scoresKey: string | null = null
  private classes = new Map<string, PreviewClasses>()
  private classesGroupId: string | null = null
  private request: PreviewRequest = {
    genes: [],
    scoreMode: 'sum',
    annotationGroupId: null,
  }
  private paused = false
  // Until start(), and after stop(): nothing is read.
  private stopped = true
  private entries = new Map<string, PreviewEntry>()
  private classColorsRead: {
    readonly version: number
    readonly mainColors: Readonly<Record<string, string>>
    readonly colors: Readonly<Record<string, string>>
  } | null = null
  version = 0

  constructor(
    urls: readonly string[],
    loaders: CollectionPreviewLoaders,
    options: { readonly concurrency?: number; readonly open?: boolean } = {},
  ) {
    this.urls = urls
    this.loaders = loaders
    this.concurrency = options.concurrency ?? PREVIEW_CONCURRENCY
    this.open = options.open ?? false
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  readonly getVersion = (): number => this.version

  // The colour of each class of the set in every preview: the main view's,
  // else the colour its dataset stores, else the palette's next unused
  // colour, given in the order the previews' classes were read. A class then
  // has one colour in every section, and two classes never share one.
  classColors(
    mainColors: Readonly<Record<string, string>>,
  ): Readonly<Record<string, string>> {
    const read = this.classColorsRead
    if (read?.version === this.version && read.mainColors === mainColors)
      return read.colors

    const colors = colorsForAnnotations(
      [...this.classes.values()].flatMap(({ classes }) => classes),
      mainColors,
    )
    this.classColorsRead = { version: this.version, mainColors, colors }
    return colors
  }

  entry(url: string): PreviewEntry {
    return this.entries.get(url) ?? EMPTY_ENTRY
  }

  setRequest(request: PreviewRequest): void {
    if (requestKey(request) === requestKey(this.request)) return

    this.request = { ...request, genes: [...request.genes] }
    // What was read for a set or for genes stays while a request asks for
    // neither, as one does while a dataset switch loads the next dataset's
    // set, so asking for the same again reads nothing.
    if (
      request.annotationGroupId !== null &&
      request.annotationGroupId !== this.classesGroupId
    ) {
      this.classes = new Map()
      this.classesGroupId = request.annotationGroupId
    }
    const scoresKey = scoresKeyOf(request)
    if (scoresKey !== null && scoresKey !== this.scoresKey) {
      this.scores = new Map()
      this.scoresKey = scoresKey
    }
    this.errors.clear()

    // Reads for the old selection stop; each dataset's next read starts when its
    // current one ends, so a positions read is never repeated.
    for (const controller of this.running.values()) controller.abort()

    this.changed()
    this.pump()
  }

  setVisible(url: string, visible: boolean): void {
    if (visible === this.visible.has(url)) return

    if (visible) {
      this.visible.add(url)
      this.pump()
    } else {
      this.visible.delete(url)
    }
  }

  setLinked(urls: readonly string[]): void {
    const next = urls.filter((url) => this.urls.includes(url))
    if (
      next.length === this.linked.length &&
      next.every((url, i) => url === this.linked[i])
    ) {
      return
    }

    this.linked = next
    this.pump()
  }

  setPaused(paused: boolean): void {
    if (paused === this.paused) return

    this.paused = paused
    this.pump()
  }

  start(): void {
    if (!this.stopped) return

    this.stopped = false
    this.lifetime = new AbortController()
    this.pump()
  }

  // Stops every read. What was read is kept for a later start().
  stop(): void {
    this.stopped = true
    this.lifetime.abort()

    for (const controller of this.running.values()) controller.abort()

    this.running.clear()
    this.changed()
  }

  private needsWork(url: string): boolean {
    if (this.unavailable.has(url) || this.errors.has(url)) return false
    if (!this.cells.has(url)) return true
    if (this.request.annotationGroupId !== null) return !this.classes.has(url)
    return this.request.genes.length > 0 && !this.scores.has(url)
  }

  private pump(): void {
    if (this.stopped || this.paused) return

    for (const url of [...this.linked, ...this.urls]) {
      if (this.running.size >= this.concurrency) return
      if (
        (this.visible.has(url) || this.linked.includes(url)) &&
        !this.running.has(url) &&
        this.needsWork(url)
      ) {
        void this.run(url)
      }
    }
  }

  private async run(url: string): Promise<void> {
    const controller = new AbortController()
    const { signal } = controller
    // The datasets read stay open until the reads end, however many others
    // are opened meanwhile.
    const release = this.loaders.retainDataset?.(url)
    this.running.set(url, controller)
    this.changed()

    try {
      const source = await this.source(url)
      let cells = this.cells.get(url)

      if (cells === undefined) {
        cells = await source.cells(this.lifetime.signal)
        this.cells.set(url, cells)
        this.changed()
      }

      const request = this.request

      if (signal.aborted) return

      if (request.annotationGroupId !== null) {
        if (!this.classes.has(url)) {
          const classes = await source.classes(cells, request.annotationGroupId, signal)
          if (!signal.aborted) this.classes.set(url, classes)
        }
      } else if (request.genes.length > 0 && !this.scores.has(url)) {
        const scores = await source.scores(
          cells,
          request.genes,
          request.scoreMode,
          signal,
        )
        if (!signal.aborted) this.scores.set(url, scores)
      }
    } catch (error) {
      if (this.stopped || signal.aborted) return

      if (error instanceof PreviewUnavailableError) {
        this.unavailable.set(url, error.message)
      } else {
        this.errors.set(url, error instanceof Error ? error.message : String(error))
      }
    } finally {
      release?.()

      if (this.running.get(url) === controller) {
        this.running.delete(url)
        this.changed()
        this.pump()
      }
    }
  }

  // Opening a dataset is shared by the reads that follow. A dataset that
  // cannot be previewed is not tried again; other failures are.
  private source(url: string): Promise<PreviewSource> {
    const existing = this.sources.get(url)
    if (existing !== undefined) return existing

    const opening = openPreviewSource(url, this.loaders, undefined, {
      open: this.open,
    }).catch((error: unknown) => {
      if (!(error instanceof PreviewUnavailableError)) this.sources.delete(url)
      throw error
    })
    this.sources.set(url, opening)
    return opening
  }

  private changed(): void {
    const entries = new Map<string, PreviewEntry>()
    // Only what the request asks for is shown.
    const showsClasses = this.request.annotationGroupId !== null
    const showsScores = scoresKeyOf(this.request) !== null

    for (const url of this.urls) {
      const previous = this.entries.get(url) ?? EMPTY_ENTRY
      const next: PreviewEntry = {
        cells: this.cells.get(url) ?? null,
        scores: showsScores ? (this.scores.get(url) ?? null) : null,
        classes: showsClasses ? (this.classes.get(url) ?? null) : null,
        loading: this.running.has(url),
        unavailable: this.unavailable.get(url) ?? null,
        error: this.errors.get(url) ?? null,
      }
      entries.set(url, sameEntry(previous, next) ? previous : next)
    }

    this.entries = entries
    this.version += 1

    for (const listener of this.listeners) listener()
  }
}

// The genes and score mode scores are read for; null when none are asked for.
function scoresKeyOf(request: PreviewRequest): string | null {
  return request.annotationGroupId !== null || request.genes.length === 0
    ? null
    : `${request.scoreMode}\u0000${request.genes.join('\u0000')}`
}

function requestKey(request: PreviewRequest): string {
  return request.annotationGroupId === null
    ? `genes\u0000${request.scoreMode}\u0000${request.genes.join('\u0000')}`
    : `annotations\u0000${request.annotationGroupId}`
}

function sameEntry(first: PreviewEntry, second: PreviewEntry): boolean {
  return (
    first.cells === second.cells &&
    first.scores === second.scores &&
    first.classes === second.classes &&
    first.loading === second.loading &&
    first.unavailable === second.unavailable &&
    first.error === second.error
  )
}
