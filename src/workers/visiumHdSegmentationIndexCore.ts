import { visiumHdSegmentationIndexTransferables } from '../datasets/visiumHdSegmentationIndex'
import {
  createVisiumHdSegmentationIndexParser,
  type VisiumHdSegmentationIndexParser,
} from '../datasets/visiumHdSegmentations'
import type {
  VisiumHdSegmentationIndexWorkerRequest,
  VisiumHdSegmentationIndexWorkerResponse,
} from './visiumHdSegmentationIndexMessages'

export type VisiumHdSegmentationIndexResponder = (
  response: VisiumHdSegmentationIndexWorkerResponse,
  transfer: Transferable[],
) => void

// Handles one worker's messages: `start`, the body's chunks, then `end`. The
// first error is reported and later messages are ignored.
export function visiumHdSegmentationIndexHandler(
  respond: VisiumHdSegmentationIndexResponder,
): (request: VisiumHdSegmentationIndexWorkerRequest) => void {
  let parser: VisiumHdSegmentationIndexParser | null = null
  let failed = false

  return (request) => {
    if (failed) {
      return
    }

    try {
      if (request.type === 'start') {
        parser = createVisiumHdSegmentationIndexParser(request.options)
        return
      }

      if (parser === null) {
        throw new Error(`Visium HD segmentation index worker got ${request.type} first.`)
      }

      if (request.type === 'chunk') {
        parser.push(new Uint8Array(request.bytes))
        return
      }

      const index = parser.finish()
      respond({ type: 'index', index }, visiumHdSegmentationIndexTransferables(index))
    } catch (cause) {
      failed = true
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
    }
  }
}
