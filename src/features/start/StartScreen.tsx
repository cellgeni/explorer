import { useEffect, useId, type MouseEvent, type ReactNode } from 'react'
import { Button, CloseIcon, IconButton } from '../../components/ui'
import type { StructuredLoadError } from '../errors/loadErrorModel'
import { OpenDatasetForm } from '../sections/DatasetInfoBlocks'
import type { OpenDatasetModel } from '../sections/datasetInfoModel'
import { USER_GUIDE_LOADING_DATA_URL } from '../shell/docLinks'
import {
  datasetLinkHref,
  examplesUnavailableMessage,
  platformDisplayName,
  type DatasetLibraryModel,
} from './datasetLibraryModel'
import { DEMO_EXAMPLE, type Example, type ExampleSource } from './examplesIndex'
import type { RecentDataset } from './recentDatasets'

interface StartScreenProps {
  readonly open: OpenDatasetModel
  readonly library: DatasetLibraryModel
  // Why the last load failed, with nothing else open.
  readonly error: StructuredLoadError | null
}

// What the canvas shows before a dataset is open (UNIFIED_PLAN.md, 15.3-A):
// the address field, recent datasets, and the example gallery. A link that
// names a dataset skips it.
export function StartScreen({ open, library, error }: StartScreenProps) {
  const headingId = useId()
  const { onLoadExamples } = library

  useEffect(() => {
    onLoadExamples()
  }, [onLoadExamples])

  return (
    <section className="start-screen" aria-labelledby={headingId}>
      <div className="start-screen-content">
        <header className="start-screen-header">
          <h2 id={headingId}>Open a dataset</h2>
          <p>
            Paste the address of a dataset folder, an H5AD or image file, or a dataset
            manifest. <a href={USER_GUIDE_LOADING_DATA_URL}>What can I open?</a>
          </p>
        </header>
        {error === null ? null : <StartScreenError error={error} />}
        <OpenDatasetForm open={open} boundaryLimit="none" />
        {library.recent.length === 0 ? null : (
          <StartScreenSection title="Recent">
            <RecentDatasetList
              recent={library.recent}
              onOpen={library.onOpen}
              onRemove={library.onRemoveRecent}
            />
          </StartScreenSection>
        )}
        <StartScreenSection title="Examples">
          <ExampleGallery library={library} variant="gallery" />
        </StartScreenSection>
      </div>
    </section>
  )
}

function StartScreenSection({
  title,
  children,
}: {
  readonly title: string
  readonly children: ReactNode
}) {
  const headingId = useId()

  return (
    <section className="start-screen-section" aria-labelledby={headingId}>
      <h3 id={headingId}>{title}</h3>
      {children}
    </section>
  )
}

function StartScreenError({ error }: { readonly error: StructuredLoadError }) {
  return (
    <div className="start-screen-error" role="alert">
      <strong>{error.title}</strong>
      <p>{error.message}</p>
      <p>{error.action}</p>
    </div>
  )
}

// A link that opens a dataset. A plain click opens it in place, keeping the
// app loaded; a middle or modified click opens the link in a new tab.
export function DatasetLink({
  url,
  onOpen,
  className,
  children,
}: {
  readonly url: string
  readonly onOpen: (url: string) => void
  readonly className?: string
  readonly children: ReactNode
}) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return
    }

    event.preventDefault()
    onOpen(url)
  }

  return (
    <a
      className={className}
      href={datasetLinkHref(url, window.location.pathname)}
      onClick={handleClick}
    >
      {children}
    </a>
  )
}

// The examples as cards on the start screen, or as a list in the dataset
// menu. While the index loads it says so; if it fails, it offers Retry and the
// demo dataset, so there is always something to open.
export function ExampleGallery({
  library,
  variant,
}: {
  readonly library: DatasetLibraryModel
  readonly variant: 'gallery' | 'menu'
}) {
  const { examples } = library
  const listClassName =
    variant === 'gallery' ? 'start-example-grid' : 'start-example-menu'

  if (examples.status === 'idle' || examples.status === 'loading') {
    return (
      <p className="start-screen-note" role="status">
        Loading examples…
      </p>
    )
  }

  if (examples.status === 'error') {
    return (
      <>
        <div className="start-examples-unavailable" role="status">
          <p>{examplesUnavailableMessage(library.examplesIndexUrl)}</p>
          <Button title="Load the examples again" onClick={library.onRetryExamples}>
            Retry
          </Button>
        </div>
        <ul className={listClassName} aria-label="Demo dataset">
          <ExampleItem example={DEMO_EXAMPLE} variant={variant} onOpen={library.onOpen} />
        </ul>
      </>
    )
  }

  const shown = examples.examples.length === 0 ? [DEMO_EXAMPLE] : examples.examples

  return (
    <ul className={listClassName} aria-label="Examples">
      {shown.map((example) => (
        <ExampleItem
          key={example.id}
          example={example}
          variant={variant}
          onOpen={library.onOpen}
        />
      ))}
    </ul>
  )
}

function ExampleItem({
  example,
  variant,
  onOpen,
}: {
  readonly example: Example
  readonly variant: 'gallery' | 'menu'
  readonly onOpen: (url: string) => void
}) {
  const platform = platformDisplayName(example.platform)

  if (variant === 'menu') {
    return (
      <li>
        <DatasetLink url={example.manifestUrl} onOpen={onOpen}>
          {example.name}
        </DatasetLink>
        {platform === null ? null : <small>{platform}</small>}
      </li>
    )
  }

  return (
    <li className="start-example">
      <DatasetLink
        className="start-example-name"
        url={example.manifestUrl}
        onOpen={onOpen}
      >
        {example.name}
      </DatasetLink>
      {platform === null ? null : <p className="start-example-platform">{platform}</p>}
      {example.description === undefined ? null : <p>{example.description}</p>}
      {example.source === undefined ? null : (
        <ExampleSourceLine source={example.source} />
      )}
    </li>
  )
}

function ExampleSourceLine({ source }: { readonly source: ExampleSource }) {
  const name = [source.repository, source.accession].filter(Boolean).join(' ')

  if (name === '' && source.license === undefined) return null

  return (
    <p className="start-example-source">
      {name === '' ? null : source.url === undefined ? (
        name
      ) : (
        <a href={source.url} target="_blank" rel="noopener noreferrer">
          {name}
        </a>
      )}
      {name !== '' && source.license !== undefined ? ' · ' : null}
      {source.license}
    </p>
  )
}

export function RecentDatasetList({
  recent,
  onOpen,
  onRemove,
}: {
  readonly recent: readonly RecentDataset[]
  readonly onOpen: (url: string) => void
  readonly onRemove: (url: string) => void
}) {
  return (
    <ul className="start-recent-list" aria-label="Recent datasets">
      {recent.map((dataset) => {
        const platform = platformDisplayName(dataset.platform)

        return (
          <li key={dataset.url}>
            <DatasetLink url={dataset.url} onOpen={onOpen}>
              {dataset.name}
            </DatasetLink>
            <small title={dataset.url}>
              {platform === null ? dataset.url : `${platform} · ${dataset.url}`}
            </small>
            <IconButton
              title={`Remove ${dataset.name} from recent datasets`}
              icon={<CloseIcon />}
              onClick={() => {
                onRemove(dataset.url)
              }}
            />
          </li>
        )
      })}
    </ul>
  )
}
