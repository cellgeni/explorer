export interface RuntimeMemorySnapshot {
  readonly usedJSHeapSize?: number
  readonly totalJSHeapSize?: number
  readonly jsHeapSizeLimit?: number
  readonly deviceMemoryGb?: number
}

export interface RuntimeMemoryScope {
  readonly performance?: {
    readonly memory?: {
      readonly usedJSHeapSize?: number
      readonly totalJSHeapSize?: number
      readonly jsHeapSizeLimit?: number
    }
  }
  readonly navigator?: {
    readonly deviceMemory?: number
  }
}

export function readRuntimeMemorySnapshot(
  scope: RuntimeMemoryScope = globalThis as unknown as RuntimeMemoryScope,
): RuntimeMemorySnapshot | null {
  const memory = scope.performance?.memory
  const usedJSHeapSize = finiteNonNegative(memory?.usedJSHeapSize)
  const totalJSHeapSize = finiteNonNegative(memory?.totalJSHeapSize)
  const jsHeapSizeLimit = finiteNonNegative(memory?.jsHeapSizeLimit)
  const deviceMemoryGb = finitePositive(scope.navigator?.deviceMemory)
  const snapshot: RuntimeMemorySnapshot = {
    ...(usedJSHeapSize === undefined ? {} : { usedJSHeapSize }),
    ...(totalJSHeapSize === undefined ? {} : { totalJSHeapSize }),
    ...(jsHeapSizeLimit === undefined ? {} : { jsHeapSizeLimit }),
    ...(deviceMemoryGb === undefined ? {} : { deviceMemoryGb }),
  }

  return Object.keys(snapshot).length === 0 ? null : snapshot
}

export function formatRuntimeMemorySnapshot(
  snapshot: RuntimeMemorySnapshot | null | undefined,
): string | undefined {
  if (snapshot === null || snapshot === undefined) {
    return undefined
  }

  const parts = [
    snapshot.usedJSHeapSize === undefined
      ? undefined
      : `used ${formatByteCount(snapshot.usedJSHeapSize)}`,
    snapshot.totalJSHeapSize === undefined
      ? undefined
      : `total ${formatByteCount(snapshot.totalJSHeapSize)}`,
    snapshot.jsHeapSizeLimit === undefined
      ? undefined
      : `limit ${formatByteCount(snapshot.jsHeapSizeLimit)}`,
    snapshot.deviceMemoryGb === undefined
      ? undefined
      : `device ${formatGigabytes(snapshot.deviceMemoryGb)}`,
  ].filter((part): part is string => part !== undefined)

  return parts.length === 0 ? undefined : parts.join(', ')
}

function finiteNonNegative(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : undefined
}

function finitePositive(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined
}

function formatByteCount(byteLength: number): string {
  if (byteLength >= 1024 * 1024 * 1024) {
    return `${(byteLength / (1024 * 1024 * 1024)).toFixed(1)} GB`
  }

  if (byteLength >= 1024 * 1024) {
    return `${(byteLength / (1024 * 1024)).toFixed(1)} MB`
  }

  if (byteLength >= 1024) {
    return `${(byteLength / 1024).toFixed(1)} KB`
  }

  return `${byteLength.toLocaleString()} bytes`
}

function formatGigabytes(value: number): string {
  return Number.isInteger(value) ? `${value} GB` : `${value.toFixed(1)} GB`
}
