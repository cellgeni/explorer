import { describe, expect, it } from 'vitest'
import type { ViewerLoadStatus } from './viewerCoreTypes'
import { readViewportMessage } from './viewerStatus'

const NO_TASKS: ReadonlySet<string> = new Set()

function message(
  status: ViewerLoadStatus,
  imageStatus: ViewerLoadStatus,
  boundaryStatus: ViewerLoadStatus,
  loadingTaskIds: ReadonlySet<string> = NO_TASKS,
  messages: Parameters<typeof readViewportMessage>[3] = {},
) {
  return readViewportMessage(
    status,
    imageStatus,
    boundaryStatus,
    messages,
    loadingTaskIds,
  )
}

describe('readViewportMessage', () => {
  it('shows nothing when every load is idle or ready', () => {
    expect(message('ready', 'ready', 'ready')).toBeNull()
    expect(message('idle', 'idle', 'idle')).toBeNull()
  })

  it.each<[ViewerLoadStatus, ViewerLoadStatus, ViewerLoadStatus, string]>([
    ['loading', 'ready', 'ready', 'Loading overview cells…'],
    ['ready', 'loading', 'ready', 'Reading OME-TIFF image…'],
    ['ready', 'ready', 'loading', 'Loading cell boundaries…'],
  ])('reports %s / %s / %s as "%s"', (status, imageStatus, boundaryStatus, text) => {
    expect(message(status, imageStatus, boundaryStatus)).toEqual({ kind: 'info', text })
  })

  it('leaves a load to its progress task when one is listed', () => {
    expect(message('loading', 'ready', 'ready', new Set(['dataset']))).toBeNull()
    expect(message('ready', 'loading', 'ready', new Set(['morphology']))).toBeNull()
    expect(message('ready', 'ready', 'loading', new Set(['boundaries']))).toBeNull()
    // A task for one load does not hide another.
    expect(message('ready', 'loading', 'ready', new Set(['dataset']))).toEqual({
      kind: 'info',
      text: 'Reading OME-TIFF image…',
    })
  })

  it('uses the given error messages, or a default for each load', () => {
    const messages = {
      errorMessage: 'cells.parquet returned 403.',
      imageErrorMessage: 'morphology.ome.tif is not a TIFF.',
      boundaryErrorMessage: 'cell_boundaries.parquet is missing.',
    }

    expect(message('error', 'ready', 'ready', NO_TASKS, messages)).toEqual({
      kind: 'error',
      text: 'cells.parquet returned 403.',
    })
    expect(message('ready', 'error', 'ready', NO_TASKS, messages)?.text).toBe(
      'morphology.ome.tif is not a TIFF.',
    )
    expect(message('ready', 'ready', 'error', NO_TASKS, messages)?.text).toBe(
      'cell_boundaries.parquet is missing.',
    )
    expect(message('error', 'ready', 'ready')?.text).toBe('Dataset load failed.')
    expect(message('ready', 'error', 'ready')?.text).toBe('OME-TIFF image load failed.')
    expect(message('ready', 'ready', 'error')?.text).toBe('Cell boundary load failed.')
  })

  it('reports the dataset first, then the image, then the boundaries', () => {
    expect(message('error', 'error', 'error')?.text).toBe('Dataset load failed.')
    expect(message('loading', 'error', 'error')?.text).toBe('Loading overview cells…')
    expect(message('ready', 'error', 'error')?.text).toBe('OME-TIFF image load failed.')
    expect(message('ready', 'loading', 'error')?.text).toBe('Reading OME-TIFF image…')
  })

  it('shows a later error while an earlier load reports its own progress', () => {
    expect(message('loading', 'error', 'ready', new Set(['dataset']))).toEqual({
      kind: 'error',
      text: 'OME-TIFF image load failed.',
    })
  })
})
