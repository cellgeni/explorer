import { merscopeTableTransferables } from '../datasets/merscopeFormat'
import { readMerscopeTable } from '../datasets/merscopeTableReader'
import type {
  MerscopeTableWorkerRequest,
  MerscopeTableWorkerResponse,
} from './merscopeTableMessages'

export type MerscopeTableResponder = (
  response: MerscopeTableWorkerResponse,
  transfer: Transferable[],
) => void

// Handles a worker's `read` request: progress messages, then the table or an
// error.
export function merscopeTableHandler(
  respond: MerscopeTableResponder,
): (request: MerscopeTableWorkerRequest) => Promise<void> {
  return (request) =>
    readMerscopeTable({
      files: request.files,
      onProgress: (message) => {
        respond({ type: 'progress', message }, [])
      },
    }).then(
      (table) => {
        respond({ type: 'table', table }, merscopeTableTransferables(table))
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
