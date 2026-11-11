import { PLATFORM_NAMES, type AppPlatformKind } from '../app-shell/platformAdapter'
import { DEFAULT_EXAMPLES_INDEX_URL } from './examplesIndex'
import type { RecentDataset } from './recentDatasets'
import type { ExamplesState } from './useExamplesIndex'

// Datasets to open with one click (UNIFIED_PLAN.md, 15.3-A): the example
// gallery and recent datasets, on the start screen and in the dataset menu.
export interface DatasetLibraryModel {
  readonly examples: ExamplesState
  // Where the gallery comes from, for the "couldn't be loaded" message.
  readonly examplesIndexUrl: string
  readonly onLoadExamples: () => void
  readonly onRetryExamples: () => void
  readonly recent: readonly RecentDataset[]
  readonly onRemoveRecent: (url: string) => void
  // Opens the dataset in place, as Load Dataset does.
  readonly onOpen: (url: string) => void
}

// The address of a link that opens a dataset, on this deployment: a gallery
// card never uses the index's viewerUrl, so self-hosted copies stay on their
// own host.
export function datasetLinkHref(datasetUrl: string, pathname: string): string {
  return `${pathname}?dataset=${encodeURIComponent(datasetUrl)}`
}

// "Xenium" for 'xenium'; an unknown platform as written, capitalised.
export function platformDisplayName(platform: string | undefined): string | null {
  if (platform === undefined) return null
  if (Object.hasOwn(PLATFORM_NAMES, platform)) {
    return PLATFORM_NAMES[platform as AppPlatformKind]
  }
  return platform.charAt(0).toUpperCase() + platform.slice(1)
}

export function examplesUnavailableMessage(examplesIndexUrl: string): string {
  if (examplesIndexUrl === DEFAULT_EXAMPLES_INDEX_URL) {
    return "Examples couldn't be loaded from GitHub."
  }

  try {
    return `Examples couldn't be loaded from ${new URL(examplesIndexUrl).host}.`
  } catch {
    return "Examples couldn't be loaded."
  }
}
