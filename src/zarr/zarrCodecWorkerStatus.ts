import type { FallbackNotice } from '../data/fallbackNotice'

export interface ZarrCodecWorkerFailure {
  readonly error: Error
  readonly timestamp: number
}

let failure: ZarrCodecWorkerFailure | null = null
const listeners = new Set<() => void>()

// Set once the Zarr decode workers fail and Zarr chunks are decoded on the
// main thread instead (src/zarr/workerZarrCodecs.ts). It lasts until the page
// is reloaded, so it is kept here rather than with the dataset's notices,
// which are cleared on each load.
export function zarrCodecWorkerFailure(): ZarrCodecWorkerFailure | null {
  return failure
}

export function subscribeZarrCodecWorkerFailure(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function reportZarrCodecWorkerFailure(error: Error): void {
  console.warn(
    'The Zarr decode workers failed, so Zarr chunks are decoded on the main thread.',
    error,
  )
  failure = { error, timestamp: Date.now() }

  for (const listener of listeners) {
    listener()
  }
}

export function zarrCodecWorkerNotice(failure: ZarrCodecWorkerFailure): FallbackNotice {
  return {
    source: 'Zarr decoding',
    message:
      'The Zarr decode workers failed, so Zarr chunks are decoded on the main thread, which can make the page less responsive.',
    action: 'Reload the page to start the workers again.',
    detail: failure.error.message,
  }
}
