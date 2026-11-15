import {
  featureBarcodeMatrixTransferables,
  readFeatureBarcodeMex,
} from '../datasets/featureBarcodeMex'
import type {
  FeatureBarcodeMexWorkerRequest,
  FeatureBarcodeMexWorkerResponse,
} from './featureBarcodeMexMessages'

export type FeatureBarcodeMexResponder = (
  response: FeatureBarcodeMexWorkerResponse,
  transfer: Transferable[],
) => void

// Handles a worker's `read` request: progress messages, then the matrix or an
// error.
export function featureBarcodeMexHandler(
  respond: FeatureBarcodeMexResponder,
): (request: FeatureBarcodeMexWorkerRequest) => Promise<void> {
  return (request) =>
    readFeatureBarcodeMex({
      urls: request.urls,
      onProgress: (message) => {
        respond({ type: 'progress', message }, [])
      },
    }).then(
      (matrix) => {
        respond({ type: 'matrix', matrix }, featureBarcodeMatrixTransferables(matrix))
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
