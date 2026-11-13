import type { AsyncBuffer } from 'hyparquet'
import {
  readSpatialDataShapes,
  spatialDataShapesTransferables,
} from '../datasets/spatialDataShapes'
import type {
  SpatialDataShapesWorkerRequest,
  SpatialDataShapesWorkerResponse,
} from './spatialDataShapesMessages'

export type SpatialDataShapesResponder = (
  response: SpatialDataShapesWorkerResponse,
  transfer: Transferable[],
) => void

// Handles one worker's messages: a `read` request, then the slices it asks
// the main thread for.
export function spatialDataShapesHandler(
  respond: SpatialDataShapesResponder,
): (request: SpatialDataShapesWorkerRequest) => void {
  const pending = new Map<
    number,
    {
      readonly resolve: (bytes: ArrayBuffer) => void
      readonly reject: (error: Error) => void
    }
  >()
  let nextSliceId = 0

  const slices = (byteLength: number): AsyncBuffer => ({
    byteLength,
    slice: (start, end = byteLength) =>
      new Promise<ArrayBuffer>((resolve, reject) => {
        const id = nextSliceId
        nextSliceId += 1
        pending.set(id, { resolve, reject })
        respond({ type: 'slice', id, start, end }, [])
      }),
  })

  return (request) => {
    if (request.type === 'slice' || request.type === 'slice-error') {
      const slice = pending.get(request.id)
      pending.delete(request.id)

      if (request.type === 'slice') {
        slice?.resolve(request.bytes)
      } else {
        slice?.reject(new Error(request.error))
      }

      return
    }

    const { source, affine } = request
    readSpatialDataShapes({
      url: source.url,
      ...(source.kind === 'slices' ? { file: slices(source.byteLength) } : {}),
      affine,
    }).then(
      (shapes) => {
        respond({ type: 'shapes', shapes }, spatialDataShapesTransferables(shapes))
      },
      (cause: unknown) => {
        respond(
          {
            type: 'error',
            error: cause instanceof Error ? cause.message : String(cause),
            ...(cause instanceof Error && cause.name.length > 0
              ? { errorName: cause.name }
              : {}),
          },
          [],
        )
      },
    )
  }
}
