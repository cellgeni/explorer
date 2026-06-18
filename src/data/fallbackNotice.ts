export interface FallbackNotice {
  readonly source: string
  readonly message: string
  readonly action?: string
  readonly detail?: string
  readonly coalesceKey?: string
}

export type FallbackNotifier = (notice: FallbackNotice) => void

export function notifyFallback(
  onFallback: FallbackNotifier | undefined,
  notice: FallbackNotice,
): void {
  onFallback?.(notice)
}
