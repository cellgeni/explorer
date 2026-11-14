import { readZipEntry } from '../data/zipArchive'
import type { ZipEntryWorkerRequest, ZipEntryWorkerResponse } from './zipEntryMessages'

export type ZipEntryResponder = (
  response: ZipEntryWorkerResponse,
  transfer: Transferable[],
) => void

// Progress is sent at most this often, in compressed bytes.
const PROGRESS_STEP_BYTES = 4 * 1024 * 1024

// Handles a worker's `read` request: progress messages, then the entry's
// bytes or an error.
export function zipEntryHandler(
  respond: ZipEntryResponder,
): (request: ZipEntryWorkerRequest) => Promise<void> {
  return (request) => {
    let reported = 0

    return readZipEntry(request.url, request.entry, {
      onProgress: (received, total) => {
        if (received === total || received - reported >= PROGRESS_STEP_BYTES) {
          reported = received
          respond({ type: 'progress', received, total }, [])
        }
      },
    }).then(
      (bytes) => {
        respond({ type: 'entry', bytes: bytes.buffer }, [bytes.buffer])
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
