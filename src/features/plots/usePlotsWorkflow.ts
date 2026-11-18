import { useCallback, useEffect, useRef, useState } from 'react'
import {
  isGeneValuesError,
  isGeneValuesSource,
  type GeneValuesSource,
} from '../../data/geneValues'
import type { SpatialDatasetLoader } from '../app-shell/appDependencies'
import {
  formatElapsed,
  invalidateLatestRequest,
  isAbortError,
  readTimestamp,
  startLatestRequest,
  type AppendDebugEvent,
  type LatestRequest,
} from '../app-shell/appRuntimeModel'
import type { PlotGeneStats, PlotGroupsInput, PlotGroupsSummary } from './plotStats'
import { createPlotStatsSession, type PlotStatsSession } from './plotStatsSession'
import { formatReadSize, plotReadDecision } from './plotsPanelModel'

// Reads what the Plots panel shows (plan 22-D6, 22-D12): a stats session
// per dataset, given the dataset's rows once and the groups once per set.
// Genes the session lacks are read from the dataset and handed to it; the
// rest come from its cache, so changing the set reads nothing again.
// Changing the genes, set or dataset cancels a read in flight. A large read
// waits for Read, and one over the budget is refused (22-D7).

export type PlotsSource =
  | { readonly kind: 'ready'; readonly source: GeneValuesSource }
  | { readonly kind: 'unavailable'; readonly reason: string }

export type PlotsSourceOpener = (url: string) => Promise<PlotsSource>

export async function openPlotsSource(
  getSpatialDataset: SpatialDatasetLoader,
  url: string,
  platformLabel: string,
): Promise<PlotsSource> {
  const dataset: unknown = await getSpatialDataset(url)

  if (!isGeneValuesSource(dataset)) {
    return {
      kind: 'unavailable',
      reason: `Plots are not available for ${platformLabel}: it has no expression matrix to read by gene.`,
    }
  }

  const estimate = await dataset.estimateGeneValuesRead([])
  return estimate.kind === 'unavailable'
    ? { kind: 'unavailable', reason: estimate.reason }
    : { kind: 'ready', source: dataset }
}

export interface PlotsGroupsRequest {
  // Changes whenever the groups' cells do.
  readonly key: string
  readonly input: PlotGroupsInput
}

export type PlotsDataStatus =
  | 'idle'
  | 'preparing'
  | 'reading'
  | 'ready'
  | 'cancelled'
  // A read waits for Read, or is over the budget (22-D7).
  | 'confirm'
  | 'too-large'
  | 'unavailable'
  | 'error'

// The read behind 'confirm' and 'too-large'.
export interface PlotsLargeRead {
  readonly genes: readonly string[]
  readonly bytes: number
  // How the matrix's layout sets the size.
  readonly detail: string | null
}

export interface PlotsData {
  readonly status: PlotsDataStatus
  // Why plots are unavailable, or what failed.
  readonly message: string | null
  // The groups the stats are for, and their sizes.
  readonly groupsKey: string | null
  readonly summary: PlotGroupsSummary | null
  readonly stats: ReadonlyMap<string, PlotGeneStats>
  readonly geneErrors: ReadonlyMap<string, string>
  readonly readingGenes: readonly string[]
  readonly largeRead: PlotsLargeRead | null
}

export interface PlotsWorkflow extends PlotsData {
  readonly cancel: () => void
  readonly retry: () => void
  // Reads the read waiting for Read.
  readonly confirmRead: () => void
}

export interface PlotsWorkflowInput {
  // The panel is open on a dataset whose cells can be grouped.
  readonly enabled: boolean
  readonly datasetUrl: string | null
  readonly openSource: PlotsSourceOpener
  readonly genes: readonly string[]
  readonly groups: PlotsGroupsRequest | null
  readonly appendDebugEvent: AppendDebugEvent
  readonly createSession?: () => PlotStatsSession
}

export const IDLE_PLOTS_DATA: PlotsData = {
  status: 'idle',
  message: null,
  groupsKey: null,
  summary: null,
  stats: new Map(),
  geneErrors: new Map(),
  readingGenes: [],
  largeRead: null,
}

interface GroupsEntry {
  readonly key: string
  readonly summary: Promise<PlotGroupsSummary>
  readonly stats: Map<string, PlotGeneStats>
}

interface DatasetEntry {
  readonly url: string
  readonly session: PlotStatsSession
  readonly source: Promise<PlotsSource>
  // The source has opened and its rows are read, or either failed; a failed
  // one is opened again, rows and all, on Try again.
  opened: 'pending' | 'ready' | 'failed'
  readonly geneErrors: Map<string, string>
  groups: GroupsEntry | null
  // The largest read Read has allowed, and the read waiting for it.
  approvedBytes: number
  askedBytes: number | null
}

export function usePlotsWorkflow({
  enabled,
  datasetUrl,
  openSource,
  genes,
  groups,
  appendDebugEvent,
  createSession = createPlotStatsSession,
}: PlotsWorkflowInput): PlotsWorkflow {
  const [data, setData] = useState<PlotsData>(IDLE_PLOTS_DATA)
  const [retryToken, setRetryToken] = useState(0)
  const entryRef = useRef<DatasetEntry | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const requestIdRef = useRef(0)
  const genesKey = genes.join('\u0000')
  const groupsKey = groups?.key ?? null

  // The latest values, read by the run below without restarting it.
  const latestRef = useRef({ genes, groups, openSource, appendDebugEvent, createSession })
  useEffect(() => {
    latestRef.current = { genes, groups, openSource, appendDebugEvent, createSession }
  })

  useEffect(() => {
    if (!enabled || datasetUrl === null) {
      const requestId = invalidateLatestRequest({ abortRef, requestIdRef })
      queueMicrotask(() => {
        if (requestIdRef.current === requestId) {
          setData((current) =>
            current.status === 'preparing' || current.status === 'reading'
              ? { ...current, status: 'idle', readingGenes: [] }
              : current,
          )
        }
      })
      return
    }

    const request = startLatestRequest({ abortRef, requestIdRef })
    void runPlots(request, datasetUrl, entryRef, latestRef.current, setData)

    return () => {
      request.abortController.abort()
    }
  }, [datasetUrl, enabled, genesKey, groupsKey, retryToken])

  // The worker goes with the panel.
  useEffect(
    () => () => {
      entryRef.current?.session.dispose()
      entryRef.current = null
    },
    [],
  )

  const cancel = useCallback(() => {
    invalidateLatestRequest({ abortRef, requestIdRef })
    setData((current) =>
      current.status === 'reading' || current.status === 'preparing'
        ? { ...current, status: 'cancelled', readingGenes: [] }
        : current,
    )
    latestRef.current.appendDebugEvent('Plots: cancelled reading genes')
  }, [])

  // Reads again what failed or was cancelled, opening the dataset again if
  // that failed.
  const retry = useCallback(() => {
    const entry = entryRef.current
    if (entry?.opened === 'failed') {
      entry.session.dispose()
      entryRef.current = null
    } else {
      entry?.geneErrors.clear()
    }
    setRetryToken((current) => current + 1)
  }, [])

  const confirmRead = useCallback(() => {
    const entry = entryRef.current
    if (entry === null || entry.askedBytes === null) return

    entry.approvedBytes = Math.max(entry.approvedBytes, entry.askedBytes)
    entry.askedBytes = null
    setRetryToken((current) => current + 1)
  }, [])

  return { ...data, cancel, retry, confirmRead }
}

async function runPlots(
  request: LatestRequest,
  url: string,
  entryRef: { current: DatasetEntry | null },
  latest: Pick<
    PlotsWorkflowInput,
    'genes' | 'groups' | 'openSource' | 'appendDebugEvent' | 'createSession'
  >,
  setData: (next: PlotsData | ((current: PlotsData) => PlotsData)) => void,
): Promise<void> {
  const { genes, groups, openSource, appendDebugEvent } = latest
  const createSession = latest.createSession ?? createPlotStatsSession
  const publish = (next: PlotsData) => {
    if (request.isCurrent()) setData(next)
  }

  let entry = entryRef.current
  if (entry === null || entry.url !== url) {
    entry?.session.dispose()
    const session = createSession()
    const created: DatasetEntry = {
      url,
      session,
      // Failing to read the rows fails the entry too, so Try again does not
      // keep the rejected promise.
      source: openSource(url)
        .then(async (opened) => {
          if (opened.kind === 'ready') {
            session.setRows(await opened.source.geneValuesRowIds())
          }
          created.opened = 'ready'
          return opened
        })
        .catch((error: unknown) => {
          created.opened = 'failed'
          throw error
        }),
      opened: 'pending',
      geneErrors: new Map(),
      groups: null,
      approvedBytes: 0,
      askedBytes: null,
    }
    entry = created
    entryRef.current = entry
  }

  const snapshot = (
    status: PlotsDataStatus,
    groupsEntry: GroupsEntry | null,
    summary: PlotGroupsSummary | null,
    readingGenes: readonly string[] = [],
    message: string | null = null,
    largeRead: PlotsLargeRead | null = null,
  ): PlotsData => ({
    status,
    message,
    groupsKey: groupsEntry?.key ?? null,
    summary,
    stats: new Map(groupsEntry?.stats ?? []),
    geneErrors: new Map(entry.geneErrors),
    readingGenes,
    largeRead,
  })

  try {
    await Promise.resolve()
    // Only while the dataset opens: the plot stays up while genes or groups
    // change.
    if (entry.opened === 'pending' && request.isCurrent()) {
      setData((current) => ({ ...current, status: 'preparing', readingGenes: [] }))
    }
    const opened = await entry.source
    if (!request.isCurrent()) return

    if (opened.kind === 'unavailable') {
      publish(snapshot('unavailable', null, null, [], opened.reason))
      return
    }

    if (groups === null || genes.length === 0) {
      publish(snapshot('idle', null, null))
      return
    }

    if (entry.groups?.key !== groups.key) {
      entry.groups = {
        key: groups.key,
        summary: entry.session.setGroups(groups.input),
        stats: new Map(),
      }
    }

    const groupsEntry = entry.groups
    const summary = await groupsEntry.summary
    if (!request.isCurrent()) return

    const needed = genes.filter(
      (gene) => !groupsEntry.stats.has(gene) && !entry.geneErrors.has(gene),
    )

    if (needed.length === 0) {
      publish(snapshot('ready', groupsEntry, summary))
      return
    }

    const held = await entry.session.stats(needed)
    for (const stats of held.stats) groupsEntry.stats.set(stats.gene, stats)
    if (!request.isCurrent()) return

    if (held.missing.length > 0) {
      const estimate = await opened.source.estimateGeneValuesRead(held.missing)
      if (!request.isCurrent()) return

      if (estimate.kind === 'unavailable') {
        publish(snapshot('unavailable', groupsEntry, summary, [], estimate.reason))
        return
      }

      const decision = plotReadDecision(estimate.bytes, entry.approvedBytes)
      if (decision !== 'read') {
        entry.askedBytes = decision === 'ask' ? estimate.bytes : null
        publish(
          snapshot(
            decision === 'ask' ? 'confirm' : 'too-large',
            groupsEntry,
            summary,
            [],
            null,
            {
              genes: held.missing,
              bytes: estimate.bytes,
              detail: estimate.detail ?? null,
            },
          ),
        )
        return
      }

      publish(snapshot('reading', groupsEntry, summary, held.missing))
      const startedAt = readTimestamp()
      const reads = await opened.source.geneValues(held.missing, {
        signal: request.signal,
      })
      const readGenes: string[] = []

      for (const read of reads) {
        if (isGeneValuesError(read)) {
          entry.geneErrors.set(read.gene, read.error)
        } else {
          entry.session.addGene(read)
          readGenes.push(read.gene)
        }
      }

      const computed = await entry.session.stats(readGenes)
      for (const stats of computed.stats) groupsEntry.stats.set(stats.gene, stats)
      for (const gene of computed.missing) {
        entry.geneErrors.set(gene, `${gene} was read but not kept; try again.`)
      }
      if (!request.isCurrent()) return

      appendDebugEvent(
        `Plots: read ${readGenes.length.toLocaleString()} ${readGenes.length === 1 ? 'gene' : 'genes'}${estimate.bytes > 0 ? ` (about ${formatReadSize(estimate.bytes)})` : ''} in ${formatElapsed(startedAt)}`,
      )
    }

    publish(snapshot('ready', groupsEntry, summary))
  } catch (error) {
    if (isAbortError(error) || !request.isCurrent()) return

    const message = error instanceof Error ? error.message : String(error)
    publish(snapshot('error', entry.groups, null, [], message))
    appendDebugEvent(`Plots failed: ${message}`)
  } finally {
    request.complete()
  }
}
