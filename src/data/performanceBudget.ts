export type PerformanceProfile = 'compact' | 'balanced' | 'expanded'

export interface PerformanceSignal {
  readonly hardwareConcurrency?: number
  readonly deviceMemory?: number
  readonly maxTouchPoints?: number
}

export interface PerformanceBudget {
  readonly profile: PerformanceProfile
  readonly overviewRenderCellLimit: number
  readonly boundaryCellLimit: number
  readonly maxConcurrentTileRequests: number
  readonly tileCacheMaxTiles: number
  // Time points read ahead while Play runs (plan 28-D8).
  readonly timePointPrefetch: number
  readonly telemetryEventLimit: number
}

const COMPACT_BUDGET: PerformanceBudget = {
  profile: 'compact',
  overviewRenderCellLimit: 75_000,
  boundaryCellLimit: 2_500,
  maxConcurrentTileRequests: 2,
  tileCacheMaxTiles: 72,
  timePointPrefetch: 1,
  telemetryEventLimit: 80,
}

const BALANCED_BUDGET: PerformanceBudget = {
  profile: 'balanced',
  overviewRenderCellLimit: 150_000,
  boundaryCellLimit: 50_000,
  maxConcurrentTileRequests: 4,
  tileCacheMaxTiles: 120,
  timePointPrefetch: 2,
  telemetryEventLimit: 120,
}

const EXPANDED_BUDGET: PerformanceBudget = {
  profile: 'expanded',
  overviewRenderCellLimit: 250_000,
  boundaryCellLimit: 50_000,
  maxConcurrentTileRequests: 6,
  tileCacheMaxTiles: 180,
  timePointPrefetch: 3,
  telemetryEventLimit: 160,
}

export function detectPerformanceBudget(
  signal: PerformanceSignal = readNavigatorPerformanceSignal(),
): PerformanceBudget {
  const cores = signal.hardwareConcurrency
  const memory = signal.deviceMemory
  const isLowCore = cores !== undefined && cores <= 4
  const isLowMemory = memory !== undefined && memory <= 4
  const isHighCore = cores !== undefined && cores >= 8
  const isHighMemory = memory !== undefined && memory >= 12

  if (isLowCore || isLowMemory) {
    return COMPACT_BUDGET
  }

  if (isHighCore && isHighMemory) {
    return EXPANDED_BUDGET
  }

  return BALANCED_BUDGET
}

export function readNavigatorPerformanceSignal(): PerformanceSignal {
  if (typeof navigator === 'undefined') {
    return {}
  }

  const candidate = navigator as Navigator & {
    readonly deviceMemory?: number
  }

  return {
    ...(candidate.hardwareConcurrency === undefined
      ? {}
      : { hardwareConcurrency: candidate.hardwareConcurrency }),
    ...(candidate.deviceMemory === undefined
      ? {}
      : { deviceMemory: candidate.deviceMemory }),
    ...(candidate.maxTouchPoints === undefined
      ? {}
      : { maxTouchPoints: candidate.maxTouchPoints }),
  }
}
