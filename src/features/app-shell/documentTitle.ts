const APP_NAME = 'Spatial Omics Explorer'
// Last path segments that say nothing about the dataset, so the folder above
// names it instead.
const GENERIC_SEGMENTS = new Set(['outs', 'explorer.json', 'experiment.xenium'])

// A short name for the loaded dataset: the manifest's name, or the last
// meaningful part of its URL.
export function datasetDisplayName(
  url: string | null,
  manifestName: string | undefined,
): string | null {
  const name = manifestName?.trim()
  if (name !== undefined && name !== '') return name
  if (url === null) return null

  let path = url.trim()
  try {
    path = new URL(path).pathname
  } catch {
    path = path.split(/[?#]/)[0] ?? ''
  }

  const segments = path
    .split('/')
    .filter((segment) => segment !== '')
    .map((segment) => {
      try {
        return decodeURIComponent(segment)
      } catch {
        return segment
      }
    })

  while (
    segments.length > 1 &&
    GENERIC_SEGMENTS.has(segments[segments.length - 1]?.toLowerCase() ?? '')
  ) {
    segments.pop()
  }

  return segments.at(-1) ?? null
}

// The browser tab title: "{dataset} · Spatial Omics Explorer".
export function documentTitle(datasetName: string | null): string {
  return datasetName === null ? APP_NAME : `${datasetName} · ${APP_NAME}`
}
