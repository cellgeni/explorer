// The file name for messages: the last path segment, or the one before a
// Zenodo `/content` suffix.
export function urlFileName(url: string): string {
  let path = url

  try {
    path = decodeURIComponent(new URL(url).pathname)
  } catch {
    // Not an absolute URL: use it as given.
  }

  const segments = path.split('/').filter((segment) => segment.length > 0)
  const last = segments.at(-1) ?? url

  return last === 'content' && segments.length > 1 ? (segments.at(-2) ?? last) : last
}
