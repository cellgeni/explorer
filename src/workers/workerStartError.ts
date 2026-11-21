// A worker that does not start, because its script is gone after an update to
// the app or the page does not allow workers (a content security policy),
// reports an error event with no message. Every new worker fails the same
// way, so retrying cannot help; reloading can.
export const WORKER_START_ERROR_NAME = 'WorkerStartError'

// The error for a worker's error event: its own message when it has one, as
// for a worker that threw, else a WorkerStartError saying what did not start.
export function workerFailureError(
  eventMessage: string | undefined,
  failureMessage: string,
): Error {
  if (eventMessage !== undefined && eventMessage !== '') {
    return new Error(eventMessage)
  }

  const error = new Error(
    `${failureMessage} It did not start: the app may have been updated since the page loaded, or the page does not allow workers.`,
  )
  error.name = WORKER_START_ERROR_NAME
  return error
}

export function isWorkerStartError(error: unknown): boolean {
  return error instanceof Error && error.name === WORKER_START_ERROR_NAME
}
