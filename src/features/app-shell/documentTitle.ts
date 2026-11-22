import { parseAnnDataSectionUrl } from '../../datasets/annDataSections'

const APP_NAME = 'Spatial Omics Explorer'
// Last path segments that say nothing about the dataset, so the folder above
// names it instead.
const GENERIC_SEGMENTS = new Set(['outs', 'explorer.json', 'experiment.xenium'])

// A short name for the loaded dataset: the manifest's name, or the last
// meaningful part of its URL, or its host.
export function datasetDisplayName(
  url: string | null,
  manifestName: string | undefined,
): string | null {
  const name = manifestName?.trim()
  if (name !== undefined && name !== '') return name
  if (url === null) return null

  let path = url.trim()
  // A dataset served from the root of a host has no path to name it.
  let host: string | null = null
  try {
    const parsed = new URL(path)
    path = parsed.pathname
    host = parsed.host === '' ? null : parsed.host
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

  const file = segments.at(-1) ?? host
  const section = parseAnnDataSectionUrl(url.trim())

  // One section of a table: "table.h5ad · section_01".
  return file === null || section?.value == null ? file : `${file} · ${section.value}`
}

// The browser tab title: "{dataset} · Spatial Omics Explorer".
export function documentTitle(datasetName: string | null): string {
  return datasetName === null ? APP_NAME : `${datasetName} · ${APP_NAME}`
}
