import type { ImagePyramidLoader } from '../../data/imagePyramid'
import { TileRequestSlots } from '../../tiff/tileRequestScheduler'
import {
  CELL_IMAGE_REQUEST_SLOTS,
  cellImageLevelReadSize,
  cellImageReadBytes,
  cellImageReadDecision,
  createCellImageTileMeasurer,
  DEFAULT_CELL_IMAGE_RADIUS,
  planCellImageMeasurement,
  runCellImageMeasurement,
  type CellImageCell,
  type CellImageLoader,
  type CellImageMeasurement,
  type CellImagePlan,
  type CellImageReadSize,
  type CellImageTileMeasurer,
} from './cellImageMeasurer'

// The measurements behind Cell Query's image columns (plan 26), for one
// dataset's cells. A measurement is one channel at one level, z plane, disc
// radius and threshold; its mean and `% above` columns come from the same
// pass (26-D3). Finished ones are kept while the dataset is open (26-D2), a
// few at most once no column uses them.

// One channel's measurement as the columns ask for it.
export interface CellImageMeasurementSpec {
  readonly channelId: string
  readonly level: number
  // The z plane of a z-stack, or null.
  readonly z: number | null
  // Micrometres, for cells without an area; null where cells have one.
  readonly radius: number | null
  // Null when only the mean is wanted.
  readonly threshold: number | null
}

// A column's own needs: the mean wants no threshold.
export interface CellImageColumnNeed {
  readonly columnId: string
  readonly stat: 'mean' | 'above'
  readonly spec: CellImageMeasurementSpec
}

export type CellImageMeasurementState =
  | { readonly status: 'planning' }
  // Over the read budget's question size: waits for Measure (26-D7). `size`
  // is what the measurement reads, or at most reads.
  | { readonly status: 'asking'; readonly size: CellImageReadSize }
  | { readonly status: 'refused'; readonly size: CellImageReadSize }
  | {
      readonly status: 'measuring'
      readonly size: CellImageReadSize
      readonly tiles: number
    }
  | { readonly status: 'cancelled' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly result: CellImageMeasurement }

export interface CellImageMeasurementContext {
  readonly cells: readonly CellImageCell[]
  // The channel's loader at a plane, or null when the canvas does not show
  // that plane.
  readonly loaderFor: (channelId: string, z: number | null) => CellImageLoader | null
  readonly onMeasured?: (
    spec: CellImageMeasurementSpec,
    ms: number,
    bytes: number,
  ) => void
}

export interface CellImageMeasurementsOptions {
  readonly createTileMeasurer?: () => CellImageTileMeasurer
  // Otsu's threshold for a channel auto-contrast has not read.
  readonly findThreshold?: (
    loader: ImagePyramidLoader,
    signal: AbortSignal,
  ) => Promise<number | undefined>
  // Finished measurements kept once no column uses them.
  readonly keepUnused?: number
}

interface Entry {
  readonly key: string
  readonly spec: CellImageMeasurementSpec
  state: CellImageMeasurementState
  controller: AbortController | null
  // Kept while asking, so Measure does not bucket the cells again.
  plan: CellImagePlan | null
  loader: CellImageLoader | null
  // What the plan reads.
  size: CellImageReadSize
  approved: boolean
  tilesDone: number
  lastUsed: number
}

type ThresholdState = number | 'finding' | 'none'

// The measurements as of a state change, for rendering.
export interface CellImageMeasurementsSnapshot {
  // The measurement a column reads, as of the last sync.
  keyFor(columnId: string): string | undefined
  state(key: string): CellImageMeasurementState | undefined
  // Otsu's threshold for a channel auto-contrast has not read.
  threshold(channelId: string): number | 'finding' | undefined
  // What measuring each level of a channel reads, from its tile index or
  // chunk sizes; null for a level that cannot tell.
  levelSizes(channelId: string): readonly (CellImageReadSize | null)[] | undefined
}

const KEEP_UNUSED = 4

export function cellImageMeasurementKey(spec: CellImageMeasurementSpec): string {
  return [
    spec.channelId,
    spec.level,
    spec.z ?? '',
    spec.radius ?? '',
    spec.threshold ?? '',
  ].join('|')
}

function groupKey(spec: CellImageMeasurementSpec): string {
  return cellImageMeasurementKey({ ...spec, threshold: null })
}

export class CellImageMeasurements {
  private readonly entries = new Map<string, Entry>()
  private readonly columnKeys = new Map<string, string>()
  private readonly thresholds = new Map<string, ThresholdState>()
  private readonly levelSizes = new Map<string, readonly (CellImageReadSize | null)[]>()
  private readonly thresholdControllers = new Set<AbortController>()
  private readonly listeners = new Set<() => void>()
  private readonly progressListeners = new Set<() => void>()
  private readonly slots = new TileRequestSlots(CELL_IMAGE_REQUEST_SLOTS)
  private readonly createTileMeasurer: () => CellImageTileMeasurer
  private readonly findThreshold: NonNullable<
    CellImageMeasurementsOptions['findThreshold']
  >
  private readonly keepUnused: number
  private tileMeasurer: CellImageTileMeasurer | null = null
  private context: CellImageMeasurementContext | null = null
  private snapshot: CellImageMeasurementsSnapshot = this.takeSnapshot()
  private progressVersion = 0
  private clock = 0

  constructor(options: CellImageMeasurementsOptions = {}) {
    this.createTileMeasurer = options.createTileMeasurer ?? createCellImageTileMeasurer
    this.findThreshold =
      options.findThreshold ??
      (async (loader, signal) => {
        const { computeChannelAutoContrast } =
          await import('../../data/morphologyContrast')
        return (await computeChannelAutoContrast(loader, { signal })).histogram.threshold
      })
    this.keepUnused = options.keepUnused ?? KEEP_UNUSED
  }

  // For useSyncExternalStore: changes when a measurement's state does, not
  // with its progress.
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  readonly getSnapshot = (): CellImageMeasurementsSnapshot => this.snapshot

  readonly subscribeProgress = (listener: () => void): (() => void) => {
    this.progressListeners.add(listener)
    return () => {
      this.progressListeners.delete(listener)
    }
  }

  readonly getProgressVersion = (): number => this.progressVersion

  // Measures what the columns need, stops what they no longer do, and keeps
  // a few finished measurements for columns that come back.
  sync(
    needs: readonly CellImageColumnNeed[],
    context: CellImageMeasurementContext,
  ): void {
    if (this.context !== null && this.context.cells !== context.cells) this.reset()
    this.context = context
    this.clock += 1

    // Each group's passes: one per threshold `% above` uses, or one for the
    // mean alone. The mean reads any finished pass of its group.
    const thresholdsByGroup = new Map<string, Set<number>>()
    for (const need of needs) {
      const group = groupKey(need.spec)
      const thresholds = thresholdsByGroup.get(group) ?? new Set<number>()
      if (need.stat === 'above' && need.spec.threshold !== null) {
        thresholds.add(need.spec.threshold)
      }
      thresholdsByGroup.set(group, thresholds)
    }

    const keysBefore = [...this.columnKeys].join('\u0000')
    this.columnKeys.clear()
    const wanted = new Map<string, CellImageMeasurementSpec>()
    for (const need of needs) {
      const group = groupKey(need.spec)
      let spec: CellImageMeasurementSpec
      if (need.stat === 'above') {
        spec = need.spec
      } else {
        const ready = [...this.entries.values()].find(
          (entry) => entry.state.status === 'ready' && groupKey(entry.spec) === group,
        )
        const [threshold = null] = thresholdsByGroup.get(group) ?? []
        spec = ready?.spec ?? { ...need.spec, threshold }
      }
      const key = cellImageMeasurementKey(spec)
      this.columnKeys.set(need.columnId, key)
      wanted.set(key, spec)
    }

    let changed = [...this.columnKeys].join('\u0000') !== keysBefore
    for (const [key, entry] of this.entries) {
      if (wanted.has(key)) {
        entry.lastUsed = this.clock
        continue
      }
      if (entry.state.status !== 'ready') {
        entry.controller?.abort()
        this.entries.delete(key)
        changed = true
      }
    }

    const unused = [...this.entries.values()]
      .filter((entry) => !wanted.has(entry.key))
      .sort((a, b) => b.lastUsed - a.lastUsed)
    for (const entry of unused.slice(this.keepUnused)) {
      this.entries.delete(entry.key)
      changed = true
    }

    for (const [key, spec] of wanted) {
      if (this.entries.has(key)) continue
      const entry: Entry = {
        key,
        spec,
        state: { status: 'planning' },
        controller: null,
        plan: null,
        loader: null,
        size: { bytes: 0, exact: true },
        approved: false,
        tilesDone: 0,
        lastUsed: this.clock,
      }
      this.entries.set(key, entry)
      changed = true
      void this.start(entry)
    }

    if (changed) this.notify()
    this.closeIdleMeasurer()
  }

  keyFor(columnId: string): string | undefined {
    return this.snapshot.keyFor(columnId)
  }

  state(key: string): CellImageMeasurementState | undefined {
    return this.snapshot.state(key)
  }

  // The share of tiles measured, while measuring.
  progress(key: string): number | null {
    const entry = this.entries.get(key)
    if (entry?.state.status !== 'measuring') return null
    return entry.state.tiles === 0 ? 1 : entry.tilesDone / entry.state.tiles
  }

  // Measure after the question (26-D7), or again after Cancel or a failure.
  measure(key: string): void {
    const entry = this.entries.get(key)
    if (entry === undefined) return
    const { status } = entry.state
    if (status === 'asking') {
      entry.approved = true
      void this.run(entry)
    } else if (status === 'cancelled' || status === 'error') {
      entry.approved = true
      entry.state = { status: 'planning' }
      this.notify()
      void this.start(entry)
    }
  }

  cancel(key: string): void {
    const entry = this.entries.get(key)
    if (entry === undefined) return
    const { status } = entry.state
    if (status !== 'planning' && status !== 'measuring') return
    entry.controller?.abort()
    entry.controller = null
    entry.plan = null
    entry.state = { status: 'cancelled' }
    this.notify()
    this.closeIdleMeasurer()
  }

  threshold(channelId: string): number | 'finding' | undefined {
    return this.snapshot.threshold(channelId)
  }

  // Otsu's threshold for each channel that has none from auto-contrast,
  // read one channel at a time.
  findThresholds(
    channels: readonly { readonly id: string; readonly loader: ImagePyramidLoader }[],
  ): void {
    const missing = channels.filter((channel) => !this.thresholds.has(channel.id))
    if (missing.length === 0) return
    for (const channel of missing) this.thresholds.set(channel.id, 'finding')
    this.notify()

    const controller = new AbortController()
    this.thresholdControllers.add(controller)
    void (async () => {
      for (const channel of missing) {
        if (controller.signal.aborted) return
        let found: ThresholdState = 'none'
        try {
          found = (await this.findThreshold(channel.loader, controller.signal)) ?? 'none'
        } catch {
          if (controller.signal.aborted) return
        }
        this.thresholds.set(channel.id, found)
        this.notify()
      }
      this.thresholdControllers.delete(controller)
    })()
  }

  // Each level's size for the Resolution list (26-D5), read once per
  // channel from its tile index or chunk sizes.
  findLevelSizes(
    channels: readonly { readonly id: string; readonly loader: CellImageLoader }[],
  ): void {
    for (const channel of channels) {
      if (this.levelSizes.has(channel.id)) continue
      const { loader } = channel
      this.levelSizes.set(channel.id, [])
      const controller = new AbortController()
      this.thresholdControllers.add(controller)
      void Promise.all(
        Array.from({ length: loader.numLevels }, async (_, level) => {
          try {
            return await cellImageLevelReadSize(loader, level, controller.signal)
          } catch {
            return null
          }
        }),
      ).then((sizes) => {
        this.thresholdControllers.delete(controller)
        if (controller.signal.aborted) return
        this.levelSizes.set(channel.id, sizes)
        this.notify()
      })
    }
  }

  // Stops everything and forgets every measurement: another dataset.
  reset(): void {
    for (const entry of this.entries.values()) entry.controller?.abort()
    for (const controller of this.thresholdControllers) controller.abort()
    this.thresholdControllers.clear()
    const had =
      this.entries.size > 0 || this.thresholds.size > 0 || this.levelSizes.size > 0
    this.entries.clear()
    this.columnKeys.clear()
    this.thresholds.clear()
    this.levelSizes.clear()
    this.context = null
    this.tileMeasurer?.close()
    this.tileMeasurer = null
    if (had) this.notify()
  }

  private async start(entry: Entry): Promise<void> {
    const context = this.context
    if (context === null) return

    const loader = context.loaderFor(entry.spec.channelId, entry.spec.z)
    if (loader === null) {
      this.settle(entry, {
        status: 'error',
        message:
          entry.spec.z === null
            ? 'The image no longer has this channel.'
            : `Show plane ${entry.spec.z.toString()} on the canvas to measure it.`,
      })
      return
    }

    const controller = new AbortController()
    entry.controller = controller
    entry.loader = loader

    try {
      // Lets the condition show that it is measuring before the cells are
      // bucketed, which takes a moment for a million cells.
      await new Promise((resolve) => setTimeout(resolve, 0))
      controller.signal.throwIfAborted()
      const plan = planCellImageMeasurement(
        loader,
        context.cells,
        entry.spec.level,
        entry.spec.radius ?? DEFAULT_CELL_IMAGE_RADIUS,
      )
      const size = await cellImageReadBytes(loader, plan, controller.signal)
      controller.signal.throwIfAborted()
      entry.plan = plan
      entry.size = size
      const decision = cellImageReadDecision(size.bytes)

      if (decision === 'refuse') {
        entry.plan = null
        this.settle(entry, { status: 'refused', size })
        return
      }
      if (decision === 'ask' && !entry.approved) {
        entry.controller = null
        this.settle(entry, { status: 'asking', size })
        return
      }
    } catch (error) {
      if (controller.signal.aborted || this.entries.get(entry.key) !== entry) return
      this.settle(entry, { status: 'error', message: errorMessage(error) })
      return
    }

    await this.run(entry)
  }

  private async run(entry: Entry): Promise<void> {
    const context = this.context
    const { plan, loader } = entry
    if (context === null || plan === null || loader === null) return

    const controller = entry.controller ?? new AbortController()
    entry.controller = controller
    entry.tilesDone = 0
    this.settle(entry, {
      status: 'measuring',
      size: entry.size,
      tiles: plan.tiles.length,
    })

    this.tileMeasurer ??= this.createTileMeasurer()
    const tileMeasurer = this.tileMeasurer
    const startedAt = performance.now()

    try {
      const result = await runCellImageMeasurement(loader, plan, {
        threshold: entry.spec.threshold ?? Number.POSITIVE_INFINITY,
        measureTile: tileMeasurer.measure,
        measureChunk: tileMeasurer.measureChunk,
        signal: controller.signal,
        slots: this.slots,
        onProgress: (done) => {
          if (this.entries.get(entry.key) !== entry) return
          const before = Math.floor((entry.tilesDone * 100) / plan.tiles.length)
          entry.tilesDone = done
          if (Math.floor((done * 100) / plan.tiles.length) !== before)
            this.notifyProgress()
        },
      })
      entry.plan = null
      entry.controller = null
      this.settle(entry, { status: 'ready', result })
      context.onMeasured?.(entry.spec, performance.now() - startedAt, result.bytes)
    } catch (error) {
      if (controller.signal.aborted || this.entries.get(entry.key) !== entry) return
      entry.plan = null
      entry.controller = null
      this.settle(entry, { status: 'error', message: errorMessage(error) })
    } finally {
      this.closeIdleMeasurer()
    }
  }

  private settle(entry: Entry, state: CellImageMeasurementState): void {
    if (this.entries.get(entry.key) !== entry) return
    entry.state = state
    this.notify()
  }

  // The workers go once nothing is being measured.
  private closeIdleMeasurer(): void {
    if (this.tileMeasurer === null) return
    const running = [...this.entries.values()].some(
      (entry) => entry.state.status === 'measuring' || entry.state.status === 'planning',
    )
    if (running) return
    this.tileMeasurer.close()
    this.tileMeasurer = null
  }

  private takeSnapshot(): CellImageMeasurementsSnapshot {
    const columnKeys = new Map(this.columnKeys)
    const states = new Map(
      [...this.entries].map(([key, entry]) => [key, entry.state] as const),
    )
    const thresholds = new Map(this.thresholds)
    const levelSizes = new Map(this.levelSizes)
    return {
      levelSizes: (channelId) => {
        const sizes = levelSizes.get(channelId)
        return sizes === undefined || sizes.length === 0 ? undefined : sizes
      },
      keyFor: (columnId) => columnKeys.get(columnId),
      state: (key) => states.get(key),
      threshold: (channelId) => {
        const state = thresholds.get(channelId)
        return state === 'none' ? undefined : state
      },
    }
  }

  private notify(): void {
    this.snapshot = this.takeSnapshot()
    this.progressVersion += 1
    for (const listener of [...this.listeners]) listener()
    for (const listener of [...this.progressListeners]) listener()
  }

  private notifyProgress(): void {
    this.progressVersion += 1
    for (const listener of [...this.progressListeners]) listener()
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
