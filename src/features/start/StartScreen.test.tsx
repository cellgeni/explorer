import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { testDatasetInfoModel, testDatasetLibraryModel } from '../../test/sectionModels'
import { DEMO_DATASET_URL } from '../../store/viewerStore'
import type { StructuredLoadError } from '../errors/loadErrorModel'
import {
  datasetLinkHref,
  examplesUnavailableMessage,
  platformDisplayName,
} from './datasetLibraryModel'
import {
  DEFAULT_EXAMPLES_INDEX_URL,
  fetchExamplesIndex,
  type Example,
} from './examplesIndex'
import { StartScreen } from './StartScreen'
import { useExamplesIndex } from './useExamplesIndex'

const SKIN: Example = {
  id: 'bia/S-BIAD2214',
  name: 'Human skin, inflamed eczema (Xenium 5K)',
  manifestUrl:
    'https://raw.githubusercontent.com/cellgeni/explorer/main/examples/bia/S-BIAD2214.json',
  platform: 'xenium',
  description: 'Fresh-frozen adult skin.',
  source: {
    repository: 'BioImage Archive',
    accession: 'S-BIAD2214',
    url: 'https://www.ebi.ac.uk/biostudies/BioImages/studies/S-BIAD2214',
    license: 'CC0 1.0',
  },
}

function renderStartScreen(
  library = testDatasetLibraryModel(),
  error: StructuredLoadError | null = null,
) {
  render(
    <StartScreen open={testDatasetInfoModel().open} library={library} error={error} />,
  )
  return screen.getByRole('region', { name: 'Open a dataset' })
}

afterEach(() => {
  window.sessionStorage.clear()
})

describe('datasetLibraryModel', () => {
  it('links to this deployment with the dataset in the query', () => {
    expect(datasetLinkHref(SKIN.manifestUrl, '/explorer/')).toBe(
      `/explorer/?dataset=${encodeURIComponent(SKIN.manifestUrl)}`,
    )
  })

  it('names platforms', () => {
    expect(platformDisplayName('visium-hd')).toBe('Visium HD')
    expect(platformDisplayName('slide-seq')).toBe('Slide-seq')
    expect(platformDisplayName('toString')).toBe('ToString')
    expect(platformDisplayName(undefined)).toBeNull()
  })

  it('says where the examples could not be loaded from', () => {
    expect(examplesUnavailableMessage(DEFAULT_EXAMPLES_INDEX_URL)).toBe(
      "Examples couldn't be loaded from GitHub.",
    )
    expect(examplesUnavailableMessage('https://data.example.test/index.json')).toBe(
      "Examples couldn't be loaded from data.example.test.",
    )
  })
})

describe('StartScreen', () => {
  it('asks for the examples, and offers the address form and a guide link', () => {
    const library = testDatasetLibraryModel({ examples: { status: 'loading' } })
    const start = renderStartScreen(library)

    expect(library.onLoadExamples).toHaveBeenCalledTimes(1)
    expect(within(start).getByLabelText('Dataset or image URL')).toHaveValue('')
    expect(within(start).getByRole('button', { name: 'Load Dataset' })).toBeVisible()
    expect(within(start).queryByLabelText('Boundary limit')).not.toBeInTheDocument()
    expect(within(start).getByRole('link', { name: 'What can I open?' })).toHaveAttribute(
      'href',
      expect.stringContaining('user-guide.md#loading-data'),
    )
    expect(within(start).getByRole('status')).toHaveTextContent('Loading examples…')
    expect(
      within(start).queryByRole('list', { name: 'Recent datasets' }),
    ).not.toBeInTheDocument()
  })

  it('shows each example as a card that opens in place', () => {
    const library = testDatasetLibraryModel({
      examples: { status: 'ready', examples: [SKIN] },
    })
    const start = renderStartScreen(library)
    const card = within(within(start).getByRole('list', { name: 'Examples' })).getByRole(
      'listitem',
    )

    expect(card).toHaveTextContent('Xenium')
    expect(card).toHaveTextContent('Fresh-frozen adult skin.')
    expect(card).toHaveTextContent('BioImage Archive S-BIAD2214 · CC0 1.0')
    expect(
      within(card).getByRole('link', { name: 'BioImage Archive S-BIAD2214' }),
    ).toHaveAttribute('href', SKIN.source?.url)

    const link = within(card).getByRole('link', { name: SKIN.name })
    expect(link).toHaveAttribute(
      'href',
      `/?dataset=${encodeURIComponent(SKIN.manifestUrl)}`,
    )

    // A modified click is left to the browser (a new tab).
    fireEvent.click(link, { metaKey: true })
    expect(library.onOpen).not.toHaveBeenCalled()

    fireEvent.click(link)
    expect(library.onOpen).toHaveBeenCalledWith(SKIN.manifestUrl)
  })

  it('offers Retry and the demo when the examples cannot be loaded', () => {
    const library = testDatasetLibraryModel({
      examples: { status: 'error', message: 'HTTP 503' },
    })
    const start = renderStartScreen(library)

    expect(start).toHaveTextContent("Examples couldn't be loaded from GitHub.")
    fireEvent.click(within(start).getByRole('button', { name: 'Retry' }))
    expect(library.onRetryExamples).toHaveBeenCalledTimes(1)

    fireEvent.click(
      within(within(start).getByRole('list', { name: 'Demo dataset' })).getByRole(
        'link',
        { name: 'Human brain (Xenium 5K demo)' },
      ),
    )
    expect(library.onOpen).toHaveBeenCalledWith(DEMO_DATASET_URL)
  })

  it('lists recent datasets, which can be removed', () => {
    const library = testDatasetLibraryModel({
      examples: { status: 'ready', examples: [] },
      recent: [
        { url: 'https://example.test/run-2', name: 'run-2', platform: 'visium-hd' },
        { url: 'https://example.test/run-1', name: 'run-1' },
      ],
    })
    const start = renderStartScreen(library)
    const recent = within(start).getByRole('list', { name: 'Recent datasets' })

    expect(within(recent).getAllByRole('listitem')[0]).toHaveTextContent(
      'run-2Visium HD · https://example.test/run-2',
    )
    fireEvent.click(within(recent).getByRole('link', { name: 'run-1' }))
    expect(library.onOpen).toHaveBeenCalledWith('https://example.test/run-1')

    fireEvent.click(
      within(recent).getByRole('button', { name: 'Remove run-2 from recent datasets' }),
    )
    expect(library.onRemoveRecent).toHaveBeenCalledWith('https://example.test/run-2')

    // An empty index still leaves something to open.
    expect(
      within(within(start).getByRole('list', { name: 'Examples' })).getByRole('link', {
        name: 'Human brain (Xenium 5K demo)',
      }),
    ).toBeInTheDocument()
  })

  it('says why the last load failed', () => {
    const start = renderStartScreen(testDatasetLibraryModel(), {
      source: 'Dataset overview',
      code: 'not-found',
      title: 'Dataset not found',
      message: 'Nothing answered at https://example.test/missing.',
      action: 'Check the address.',
    })

    expect(within(start).getByRole('alert')).toHaveTextContent(
      'Dataset not foundNothing answered at https://example.test/missing.Check the address.',
    )
  })
})

describe('useExamplesIndex', () => {
  it('fetches once, keeps the result for the session, and retries', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ version: 1, examples: [SKIN] }))
    const { result, unmount } = renderHook(() =>
      useExamplesIndex({
        url: DEFAULT_EXAMPLES_INDEX_URL,
        loadIndex: (url, { signal }) => fetchExamplesIndex(url, { fetchImpl, signal }),
      }),
    )

    expect(result.current.state).toEqual({ status: 'idle' })
    await act(async () => {
      result.current.load()
      result.current.load()
    })
    expect(result.current.state).toEqual({ status: 'ready', examples: [SKIN] })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    await act(async () => {
      result.current.load()
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    unmount()

    // The session's copy: no fetch.
    const reopened = renderHook(() =>
      useExamplesIndex({
        url: DEFAULT_EXAMPLES_INDEX_URL,
        loadIndex: (url, { signal }) => fetchExamplesIndex(url, { fetchImpl, signal }),
      }),
    )
    expect(reopened.result.current.state).toEqual({ status: 'ready', examples: [SKIN] })

    await act(async () => {
      reopened.result.current.retry()
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('reports a failure, and load tries again', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('down', { status: 503 }))
      .mockResolvedValueOnce(Response.json({ version: 1, examples: [] }))
    const { result } = renderHook(() =>
      useExamplesIndex({
        url: DEFAULT_EXAMPLES_INDEX_URL,
        loadIndex: (url, { signal }) => fetchExamplesIndex(url, { fetchImpl, signal }),
      }),
    )

    await act(async () => {
      result.current.load()
    })
    expect(result.current.state).toEqual({
      status: 'error',
      message: 'The examples index answered HTTP 503.',
    })

    await act(async () => {
      result.current.load()
    })
    expect(result.current.state).toEqual({ status: 'ready', examples: [] })
  })
})
