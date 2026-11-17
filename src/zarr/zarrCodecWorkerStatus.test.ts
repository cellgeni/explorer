import { describe, expect, it, vi } from 'vitest'
import {
  reportZarrCodecWorkerFailure,
  subscribeZarrCodecWorkerFailure,
  zarrCodecWorkerFailure,
  zarrCodecWorkerNotice,
} from './zarrCodecWorkerStatus'

describe('zarrCodecWorkerStatus', () => {
  it('keeps the failure, tells subscribers and warns', () => {
    const error = new Error('Zarr decode worker failed.')
    const listener = vi.fn()
    const unsubscribe = subscribeZarrCodecWorkerFailure(listener)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(zarrCodecWorkerFailure()).toBeNull()

    try {
      reportZarrCodecWorkerFailure(error)
      unsubscribe()
      reportZarrCodecWorkerFailure(error)

      expect(warn).toHaveBeenCalledWith(
        'The Zarr decode workers failed, so Zarr chunks are decoded on the main thread.',
        error,
      )
    } finally {
      warn.mockRestore()
    }

    expect(listener).toHaveBeenCalledOnce()
    expect(zarrCodecWorkerFailure()).toMatchObject({ error })
  })

  it('describes the failure as a data access notice', () => {
    expect(
      zarrCodecWorkerNotice({
        error: new Error('Zarr decode worker failed.'),
        timestamp: 0,
      }),
    ).toEqual({
      source: 'Zarr decoding',
      message:
        'The Zarr decode workers failed, so Zarr chunks are decoded on the main thread, which can make the page less responsive.',
      action: 'Reload the page to start the workers again.',
      detail: 'Zarr decode worker failed.',
    })
  })
})
