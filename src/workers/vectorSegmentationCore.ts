import { spatialDataShapesTransferables } from '../datasets/spatialDataShapes'
import { readVectorSegmentation } from '../datasets/vectorSegmentation'
import type {
  VectorSegmentationWorkerRequest,
  VectorSegmentationWorkerResponse,
} from './vectorSegmentationMessages'

export type VectorSegmentationResponder = (
  response: VectorSegmentationWorkerResponse,
  transfer: Transferable[],
) => void

// Progress is reported at most this often.
const PROGRESS_INTERVAL_MS = 250

// Handles one worker's `read` request.
export function vectorSegmentationHandler(
  respond: VectorSegmentationResponder,
  now: () => number = () => performance.now(),
): (request: VectorSegmentationWorkerRequest) => void {
  return (request) => {
    let lastProgress = now()

    readVectorSegmentation({
      file: request.file,
      format: request.format,
      micrometersPerUnit: request.micrometersPerUnit,
      onProgress: (shapeCount) => {
        const time = now()

        if (time - lastProgress >= PROGRESS_INTERVAL_MS) {
          lastProgress = time
          respond({ type: 'progress', shapeCount }, [])
        }
      },
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
