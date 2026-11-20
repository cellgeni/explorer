// A lazily loaded part of the app that no longer exists on the server: after
// a deploy replaces the hashed assets, a tab opened before it asks for chunks
// that are gone (EXP-021). Reloading fetches the new app. Nothing reloads by
// itself, so a genuine outage is not retried in a loop.

const STALE_CHUNK_ERROR_NAME = 'StaleChunkError'

// What each browser says when a dynamic import's module fails to load, and
// Vite's own message when it cannot preload a chunk's CSS.
const STALE_CHUNK_MESSAGES = [
  /failed to fetch dynamically imported module/i, // Chromium
  /error loading dynamically imported module/i, // Firefox
  /importing a module script failed/i, // Safari
  /unable to preload css/i, // Vite
]

export const APP_UPDATED_ACTION = 'The app was updated. Reload the page.'

export function isStaleChunkError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === STALE_CHUNK_ERROR_NAME ||
      STALE_CHUNK_MESSAGES.some((pattern) => pattern.test(error.message)))
  )
}

// Vite reports a failed chunk preload as `vite:preloadError` before
// rethrowing it; naming the error lets any wording be recognised.
export function installStaleChunkDetection(target: EventTarget = window): () => void {
  const onPreloadError = (event: Event) => {
    const payload = (event as Event & { readonly payload?: unknown }).payload

    if (payload instanceof Error) {
      payload.name = STALE_CHUNK_ERROR_NAME
    }
  }

  target.addEventListener('vite:preloadError', onPreloadError)
  return () => target.removeEventListener('vite:preloadError', onPreloadError)
}
