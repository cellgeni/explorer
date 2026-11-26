import type { DatasetReader } from '../../datasets/datasetReader'
import { PLATFORM_NAMES, type AppPlatformKind } from '../app-shell/platformAdapter'
import {
  DEFAULT_EXAMPLES_INDEX_URL,
  isCollectionExample,
  type Example,
} from './examplesIndex'
import type { RecentDataset } from './recentDatasets'
import type { ExamplesState } from './useExamplesIndex'

// Datasets to open with one click (plan 15.3-A): the example
// gallery and recent datasets, on the start screen and in the dataset menu.
export interface DatasetLibraryModel {
  readonly examples: ExamplesState
  // Where the gallery comes from, for the "couldn't be loaded" message.
  readonly examplesIndexUrl: string
  readonly onLoadExamples: () => void
  readonly onRetryExamples: () => void
  readonly recent: readonly RecentDataset[]
  readonly onRemoveRecent: (url: string) => void
  // Opens the dataset in place, as Load Dataset does, with the reader a
  // recent dataset was opened with.
  readonly onOpen: (url: string, reader?: DatasetReader | null) => void
}

// The address of a link that opens a dataset, on this deployment: a gallery
// card never uses the index's viewerUrl, so self-hosted copies stay on their
// own host.
export function datasetLinkHref(
  datasetUrl: string,
  pathname: string,
  reader: DatasetReader | null = null,
): string {
  const href = `${pathname}?dataset=${encodeURIComponent(datasetUrl)}`
  return reader === null ? href : `${href}&reader=${reader}`
}

// The address that opens a collection, on this deployment. The viewer reads
// a collection only from the address, so following it reloads the page.
export function collectionLinkHref(collectionUrl: string, pathname: string): string {
  return `${pathname}?collection=${encodeURIComponent(collectionUrl)}`
}

// What an example card says it is: its platform, or a collection and its size.
export function exampleKindLabel(example: Example): string | null {
  if (!isCollectionExample(example)) return platformDisplayName(example.platform)

  const count = example.datasets
  if (count === undefined) return 'Collection'
  return `Collection of ${count.toLocaleString()} ${count === 1 ? 'dataset' : 'datasets'}`
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
