import {
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { Button, CloseIcon, IconButton } from '../../components/ui'
import type { StructuredLoadError } from '../errors/loadErrorModel'
import { OpenDatasetForm } from '../sections/DatasetInfoBlocks'
import type { OpenDatasetModel } from '../sections/datasetInfoModel'
import { USER_GUIDE_LOADING_DATA_URL } from '../shell/docLinks'
import {
  collectionLinkHref,
  datasetLinkHref,
  exampleKindLabel,
  examplesUnavailableMessage,
  platformDisplayName,
  type DatasetLibraryModel,
} from './datasetLibraryModel'
import {
  DEMO_EXAMPLE,
  isCollectionExample,
  type Example,
  type ExampleSource,
} from './examplesIndex'
import type { RecentDataset } from './recentDatasets'
import { ReloadAppButton } from '../errors/ReloadAppButton'

interface StartScreenProps {
  readonly open: OpenDatasetModel
  readonly library: DatasetLibraryModel
  // Why the last load failed, with nothing else open.
  readonly error: StructuredLoadError | null
}

// What the canvas shows before a dataset is open (plan 15.3-A):
// the address field, recent datasets, and the example gallery. A link that
// names a dataset skips it.
export function StartScreen({ open, library, error }: StartScreenProps) {
  const headingId = useId()
  const { onLoadExamples } = library
  const sectionRef = useRef<HTMLElement>(null)

  useEffect(() => {
    onLoadExamples()
  }, [onLoadExamples])

  // The screen leaves while a load runs and comes back with its error, so the
  // field that was focused has gone: focus its successor, to correct the
  // address (EXP-316).
  const focusAddressAfterError = useEffectEvent(() => {
    const active = document.activeElement
    if (error === null || (active !== null && active !== document.body)) return
    sectionRef.current?.querySelector<HTMLElement>('input[name="datasetUrl"]')?.focus()
  })
  useEffect(() => {
    focusAddressAfterError()
  }, [])

  return (
    <section ref={sectionRef} className="start-screen" aria-labelledby={headingId}>
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
      {error.code === 'app-updated' ? <ReloadAppButton /> : null}
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
  readonly className?: string | undefined
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
  const retriedRef = useRef(false)
  const loadingRef = useRef<HTMLParagraphElement>(null)
  const unavailableRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  // Retry replaces itself with "Loading examples…", and that is replaced by
  // the examples or Retry again, so keyboard focus follows each rather than
  // falling to the page.
  useLayoutEffect(() => {
    if (!retriedRef.current) return

    if (examples.status === 'idle' || examples.status === 'loading') {
      loadingRef.current?.focus()
      return
    }

    retriedRef.current = false
    const target =
      examples.status === 'error'
        ? unavailableRef.current?.querySelector<HTMLElement>('button')
        : listRef.current?.querySelector<HTMLElement>('a, button')
    target?.focus()
  }, [examples.status])

  if (examples.status === 'idle' || examples.status === 'loading') {
    return (
      <p ref={loadingRef} className="start-screen-note" role="status" tabIndex={-1}>
        Loading examples…
      </p>
    )
  }

  if (examples.status === 'error') {
    return (
      <>
        <div ref={unavailableRef} className="start-examples-unavailable" role="status">
          <p>{examplesUnavailableMessage(library.examplesIndexUrl)}</p>
          <Button
            title="Load the examples again"
            onClick={() => {
              retriedRef.current = true
              library.onRetryExamples()
            }}
          >
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
    <ul ref={listRef} className={listClassName} aria-label="Examples">
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

// A dataset opens in place. A collection is a plain link, since the viewer
// opens a collection only from the address.
function ExampleLink({
  example,
  onOpen,
  className,
}: {
  readonly example: Example
  readonly onOpen: (url: string) => void
  readonly className?: string
}) {
  if (isCollectionExample(example)) {
    return (
      <a
        className={className}
        href={collectionLinkHref(example.collectionUrl, window.location.pathname)}
      >
        {example.name}
      </a>
    )
  }

  return (
    <DatasetLink className={className} url={example.manifestUrl} onOpen={onOpen}>
      {example.name}
    </DatasetLink>
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
  const kind = exampleKindLabel(example)

  if (variant === 'menu') {
    return (
      <li>
        <ExampleLink example={example} onOpen={onOpen} />
        {kind === null ? null : <small>{kind}</small>}
      </li>
    )
  }

  return (
    <li className="start-example">
      <ExampleLink className="start-example-name" example={example} onOpen={onOpen} />
      {kind === null ? null : <p className="start-example-platform">{kind}</p>}
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
  const listRef = useRef<HTMLUListElement>(null)
  // The entry removed, and where focus goes if the list goes with it.
  const removedRef = useRef<{
    readonly index: number
    readonly fallback: HTMLElement | null
  } | null>(null)

  // Remove takes its own button away, so focus moves to the next entry's
  // Remove, or the last one's.
  useLayoutEffect(() => {
    const removed = removedRef.current
    if (removed === null) return
    removedRef.current = null
    const buttons =
      listRef.current?.querySelectorAll<HTMLElement>('.start-recent-remove') ?? []
    const next = buttons[Math.min(removed.index, buttons.length - 1)]
    ;(next ?? removed.fallback)?.focus()
  }, [recent])

  // Removing the last entry takes the list and its heading away: focus goes
  // to the address field beside them.
  useLayoutEffect(
    () => () => {
      const removed = removedRef.current
      if (removed !== null) {
        queueMicrotask(() => {
          removed.fallback?.focus()
        })
      }
    },
    [],
  )

  return (
    <ul ref={listRef} className="start-recent-list" aria-label="Recent datasets">
      {recent.map((dataset, index) => {
        const platform = platformDisplayName(dataset.platform)

        return (
          <li key={dataset.url}>
            {dataset.signed === true ? (
              // Its signature was not kept, so the address alone would be
              // refused.
              <span title="Signed address not kept: open it from its full address">
                {dataset.name}
              </span>
            ) : (
              <DatasetLink url={dataset.url} onOpen={onOpen}>
                {dataset.name}
              </DatasetLink>
            )}
            <small title={dataset.url}>
              {[
                platform,
                dataset.url,
                dataset.signed === true ? 'signed address not kept' : null,
              ]
                .filter((part) => part !== null)
                .join(' · ')}
            </small>
            <IconButton
              className="start-recent-remove"
              title={`Remove ${dataset.name} from recent datasets`}
              icon={<CloseIcon />}
              onClick={() => {
                removedRef.current = {
                  index,
                  fallback:
                    listRef.current
                      ?.closest('.start-screen, [role="dialog"]')
                      ?.querySelector<HTMLElement>('input[name="datasetUrl"]') ?? null,
                }
                onRemove(dataset.url)
              }}
            />
          </li>
        )
      })}
    </ul>
  )
}
