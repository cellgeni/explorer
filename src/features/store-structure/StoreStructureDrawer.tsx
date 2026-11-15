import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { Button, ChevronRightIcon, Disclosure, Drawer } from '../../components/ui'
import { classNames } from '../../components/ui/classNames'
import type {
  ZarrStructure,
  ZarrStructureNode,
  ZarrStructureNodeKind,
} from '../../zarr/zarrStructure'
import {
  allBranchPaths,
  filterStructure,
  findNode,
  formatBytes,
  formatCount,
  formatJson,
  formatShape,
  initiallyExpanded,
  nodeRole,
  nodeSummary,
  nodeUrl,
  parquetNote,
  structureContentsLabel,
  structureFormatLabel,
  structureNotes,
  structureSourceLabel,
} from './storeStructureModel'
import type { StoreStructureState, StoreStructureStore } from './useStoreStructure'

// Browse Store's drawer: the groups and arrays of the Zarr store at the
// address in the dataset field, read without opening it as a dataset. It sits
// over the right of the canvas and is not modal.
export function StoreStructureDrawer({ store }: { readonly store: StoreStructureStore }) {
  return (
    <Drawer
      title="Store structure"
      side="right"
      open={store.open}
      onClose={store.close}
      className="store-structure-drawer"
    >
      <StoreStructureView state={store.state} onRetry={store.retry} />
    </Drawer>
  )
}

export function StoreStructureView({
  state,
  onRetry,
}: {
  readonly state: StoreStructureState
  readonly onRetry: () => void
}) {
  switch (state.status) {
    case 'idle':
      return <p className="shell-drawer-empty">No store is open.</p>
    case 'loading':
      return (
        <div className="store-structure-status">
          <StoreAddress url={state.url} />
          <p role="status">
            {state.nodesRead === 0
              ? 'Reading the store…'
              : `Reading the store… ${formatCount(state.nodesRead, 'node')} read`}
          </p>
        </div>
      )
    case 'error':
      return (
        <div className="store-structure-status">
          <StoreAddress url={state.url} />
          <div className="store-structure-error" role="alert">
            <strong>{state.error.title}</strong>
            <p>{state.error.message}</p>
            <p>{state.error.action}</p>
            <Button title="Read the store again" onClick={onRetry}>
              Retry
            </Button>
          </div>
        </div>
      )
    case 'ready':
      return <StructureBrowser key={state.url} structure={state.structure} />
  }
}

function StoreAddress({ url }: { readonly url: string }) {
  return (
    <p className="store-structure-url" title={url}>
      {url}
    </p>
  )
}

// Children shown at first under one group; more on request.
const CHILD_PAGE_SIZE = 200

function StructureBrowser({ structure }: { readonly structure: ZarrStructure }) {
  const filterId = useId()
  const [expanded, setExpanded] = useState(() => initiallyExpanded(structure))
  const [selectedPath, setSelectedPath] = useState('')
  const [query, setQuery] = useState('')
  // Groups closed while a filter opens every match's ancestors.
  const [filterCollapsed, setFilterCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [childLimits, setChildLimits] = useState<ReadonlyMap<string, number>>(new Map())
  const filter = useMemo(
    () => filterStructure(structure.root, query),
    [query, structure.root],
  )
  const selected = findNode(structure.root, selectedPath) ?? structure.root
  const notes = structureNotes(structure)

  // While filtering, the ancestors of matches are open unless closed since.
  const isExpanded = (path: string) =>
    filter?.expanded.has(path) === true ? !filterCollapsed.has(path) : expanded.has(path)

  const toggle = (path: string) => {
    if (filter?.expanded.has(path) === true) {
      setFilterCollapsed((current) => toggled(current, path))
      return
    }

    setExpanded((current) => toggled(current, path))
  }

  return (
    <div className="store-structure">
      <div className="store-structure-header">
        <StoreAddress url={structure.url} />
        <dl className="store-structure-summary">
          <div>
            <dt>Format</dt>
            <dd>{structureFormatLabel(structure)}</dd>
          </div>
          <div>
            <dt>Listed from</dt>
            <dd>{structureSourceLabel(structure)}</dd>
          </div>
          {structure.conventions.length === 0 ? null : (
            <div>
              <dt>Written as</dt>
              <dd>{structure.conventions.join(', ')}</dd>
            </div>
          )}
          <div>
            <dt>Contents</dt>
            <dd>{structureContentsLabel(structure)}</dd>
          </div>
          {structure.zip === undefined ? null : (
            <div>
              <dt>Zip</dt>
              <dd>
                {formatCount(structure.zip.fileCount, 'file')},{' '}
                {formatBytes(structure.zip.bytes)}
                {structure.zip.root === '' ? null : (
                  <>
                    {' '}
                    in <code>{structure.zip.root}</code>
                  </>
                )}
              </dd>
            </div>
          )}
        </dl>
        {notes.map((note) => (
          <p key={note} className="store-structure-note">
            {note}
          </p>
        ))}
        <div className="store-structure-tools">
          <label className="visually-hidden" htmlFor={filterId}>
            Filter by name or path
          </label>
          <input
            id={filterId}
            type="search"
            className="store-structure-filter"
            placeholder="Filter by name or path"
            title="Show the groups, arrays and files whose name contains this text, or whose path does when the text has a /"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(event) => {
              setQuery(event.currentTarget.value)
              setFilterCollapsed(new Set())
            }}
          />
          <Button
            title="Open every group"
            variant="ghost"
            onClick={() => {
              setExpanded(new Set(allBranchPaths(structure.root)))
              setFilterCollapsed(new Set())
            }}
          >
            Expand All
          </Button>
          <Button
            title="Close every group but the root"
            variant="ghost"
            onClick={() => {
              setExpanded(new Set(['']))
              setFilterCollapsed(new Set(allBranchPaths(structure.root)))
            }}
          >
            Collapse All
          </Button>
        </div>
        {filter === null ? null : (
          <p className="store-structure-match-count" role="status">
            {filter.matchCount === 0
              ? 'Nothing matches.'
              : `${formatCount(filter.matchCount, 'match', 'matches')}.`}
          </p>
        )}
      </div>
      <div className="store-structure-tree">
        <ul aria-label="Store contents">
          <TreeItem
            node={structure.root}
            depth={0}
            selectedPath={selected.path}
            visible={filter?.visible ?? null}
            isExpanded={isExpanded}
            childLimits={childLimits}
            onToggle={toggle}
            onSelect={setSelectedPath}
            onShowMore={(path, limit) => {
              setChildLimits((current) => new Map(current).set(path, limit))
            }}
          />
        </ul>
      </div>
      <NodeDetails structure={structure} node={selected} />
    </div>
  )
}

function toggled(set: ReadonlySet<string>, path: string): ReadonlySet<string> {
  const next = new Set(set)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  return next
}

interface TreeItemProps {
  readonly node: ZarrStructureNode
  readonly depth: number
  readonly selectedPath: string
  // Paths shown while filtering; null shows every node.
  readonly visible: ReadonlySet<string> | null
  readonly isExpanded: (path: string) => boolean
  readonly childLimits: ReadonlyMap<string, number>
  readonly onToggle: (path: string) => void
  readonly onSelect: (path: string) => void
  readonly onShowMore: (path: string, limit: number) => void
}

function TreeItem(props: TreeItemProps) {
  const { node, depth, selectedPath, visible, isExpanded, childLimits } = props
  const children =
    visible === null
      ? node.children
      : node.children.filter((child) => visible.has(child.path))
  const hasChildren = children.length > 0
  const open = hasChildren && isExpanded(node.path)
  const limit = childLimits.get(node.path) ?? CHILD_PAGE_SIZE
  const shown = children.slice(0, limit)
  const role = nodeRole(node)
  const label = node.path === '' ? 'the root' : node.name
  const isSelected = node.path === selectedPath

  return (
    <li>
      <div
        className={classNames('store-structure-row', isSelected && 'is-selected')}
        style={{ paddingLeft: `${depth * 14}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="store-structure-toggle"
            aria-expanded={open}
            aria-label={`${open ? 'Collapse' : 'Expand'} ${label}`}
            title={`${open ? 'Collapse' : 'Expand'} ${label}`}
            onClick={() => {
              props.onToggle(node.path)
            }}
          >
            <ChevronRightIcon />
          </button>
        ) : (
          <span className="store-structure-toggle" aria-hidden="true" />
        )}
        <button
          type="button"
          className="store-structure-node"
          aria-current={isSelected ? 'true' : undefined}
          title={`Show details of ${node.path === '' ? '/' : node.path}`}
          onClick={() => {
            props.onSelect(node.path)
          }}
        >
          <NodeKindIcon kind={node.kind} />
          <span className="store-structure-name">{node.name}</span>
          {role === null ? null : <span className="store-structure-badge">{role}</span>}
          {node.unlisted === true ? (
            <span className="store-structure-badge is-warning">not listed</span>
          ) : null}
          <span className="store-structure-meta">{nodeSummary(node)}</span>
        </button>
      </div>
      {open ? (
        <ul>
          {shown.map((child) => (
            <TreeItem key={child.path} {...props} node={child} depth={depth + 1} />
          ))}
          {shown.length < children.length ? (
            <li>
              <div
                className="store-structure-row"
                style={{ paddingLeft: `${(depth + 1) * 14}px` }}
              >
                <span className="store-structure-toggle" aria-hidden="true" />
                <Button
                  title={`Show more of the ${children.length.toLocaleString()} items in ${label}`}
                  variant="ghost"
                  className="store-structure-more"
                  onClick={() => {
                    props.onShowMore(node.path, limit + CHILD_PAGE_SIZE * 5)
                  }}
                >
                  Show More ({(children.length - shown.length).toLocaleString()} hidden)
                </Button>
              </div>
            </li>
          ) : null}
        </ul>
      ) : null}
    </li>
  )
}

const KIND_LABELS: Readonly<Record<ZarrStructureNodeKind, string>> = {
  group: 'Group',
  array: 'Array',
  folder: 'Folder',
  file: 'File',
}

function NodeKindIcon({ kind }: { readonly kind: ZarrStructureNodeKind }) {
  return (
    <>
      <svg
        className={`ui-icon store-structure-kind is-${kind}`}
        viewBox="0 0 16 16"
        aria-hidden="true"
        focusable="false"
      >
        {kind === 'array' ? (
          <path d="M2.5 2.5h11v11h-11zM2.5 6.2h11M2.5 9.8h11M6.2 2.5v11M9.8 2.5v11" />
        ) : kind === 'file' ? (
          <path d="M4 1.8h5l3 3v9.4H4zM9 1.8v3h3" />
        ) : (
          <path
            d="M1.8 4.2v8.6h12.4V5.6H8L6.6 3.6H1.8z"
            strokeDasharray={kind === 'folder' ? '2 1.5' : undefined}
          />
        )}
      </svg>
      <span className="visually-hidden">{KIND_LABELS[kind]}: </span>
    </>
  )
}

function NodeDetails({
  structure,
  node,
}: {
  readonly structure: ZarrStructure
  readonly node: ZarrStructureNode
}) {
  const headingId = useId()
  const role = nodeRole(node)
  const url = nodeUrl(structure, node)
  const note = parquetNote(node)
  const attributes = Object.keys(node.attributes).length === 0 ? null : node.attributes
  const array = node.array

  return (
    <section className="store-structure-details" aria-labelledby={headingId}>
      <h3 id={headingId}>{node.path === '' ? 'Root' : node.name}</h3>
      <dl className="store-structure-facts">
        <Fact label="Path">
          <code>/{node.path}</code>
        </Fact>
        <Fact label="Kind">{kindDescription(node)}</Fact>
        {role === null ? null : <Fact label="Role">{role}</Fact>}
        {array === undefined ? null : (
          <>
            <Fact label="Shape">
              {formatShape(array.shape)}
              {array.dimensionNames === undefined
                ? null
                : ` (${array.dimensionNames.map((name) => name ?? '–').join(', ')})`}
            </Fact>
            <Fact label="Data type">{array.dtype}</Fact>
            {array.innerChunks === undefined ? (
              <Fact label="Chunks">
                {formatShape(array.chunks)} · {formatCount(array.chunkCount, 'chunk')}
              </Fact>
            ) : (
              <>
                <Fact label="Shards">
                  {formatShape(array.chunks)} · {formatCount(array.chunkCount, 'shard')}
                </Fact>
                <Fact label="Chunks">{formatShape(array.innerChunks)} in each shard</Fact>
              </>
            )}
            <Fact label="Codecs">
              {array.codecs.length === 0 ? 'None' : array.codecs.join(' → ')}
            </Fact>
            {array.innerCodecs === undefined ? null : (
              <Fact label="In each shard">
                {array.innerCodecs.length === 0 ? 'None' : array.innerCodecs.join(' → ')}
              </Fact>
            )}
            <Fact label="Fill value">{JSON.stringify(array.fillValue)}</Fact>
            {array.order === undefined ? null : <Fact label="Order">{array.order}</Fact>}
            {array.decodedBytes === undefined ? null : (
              <Fact label="Decoded">{formatBytes(array.decodedBytes)}</Fact>
            )}
          </>
        )}
        {node.storedBytes === undefined ? null : (
          <Fact label={node.kind === 'array' ? 'Stored' : 'Size'}>
            {formatBytes(node.storedBytes)}
            {node.storedChunks === undefined
              ? null
              : ` in ${formatCount(node.storedChunks, 'chunk file')}`}
          </Fact>
        )}
        {node.kind === 'group' || node.kind === 'folder' ? (
          <Fact label="Holds">
            {childCounts(node)}
            {node.unlisted === true ? ' listed; there may be more' : null}
          </Fact>
        ) : null}
      </dl>
      {note === null ? null : <p className="store-structure-empty">{note}</p>}
      {url === null ? null : <NodeAddress url={url} />}
      {attributes === null ? (
        <p className="store-structure-empty">No attributes.</p>
      ) : (
        <JsonBlock title="Attributes" value={attributes} />
      )}
      {node.metadata === undefined ? null : (
        <Disclosure
          title="Show the node's Zarr metadata document"
          summary="Zarr metadata"
          className="store-structure-metadata"
        >
          <JsonBlock value={node.metadata} />
        </Disclosure>
      )}
    </section>
  )
}

function Fact({
  label,
  children,
}: {
  readonly label: string
  readonly children: ReactNode
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

function kindDescription(node: ZarrStructureNode): string {
  switch (node.kind) {
    case 'array':
      return node.metadata?.zarr_format === 3 ? 'Array (Zarr v3)' : 'Array (Zarr v2)'
    case 'group':
      return node.implicit === true ? 'Group (no metadata of its own)' : 'Group'
    case 'folder':
      return 'Folder (not Zarr)'
    case 'file':
      return 'File (not Zarr)'
  }
}

function childCounts(node: ZarrStructureNode): string {
  if (node.children.length === 0) {
    return 'Nothing'
  }

  const counts = new Map<ZarrStructureNodeKind, number>()

  for (const child of node.children) {
    counts.set(child.kind, (counts.get(child.kind) ?? 0) + 1)
  }

  const nouns: Readonly<Record<ZarrStructureNodeKind, string>> = {
    group: 'group',
    array: 'array',
    folder: 'folder',
    file: 'file',
  }

  return Array.from(counts, ([kind, count]) => formatCount(count, nouns[kind])).join(
    ' · ',
  )
}

const COPY_STATUS_MS = 2000

function NodeAddress({ url }: { readonly url: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle')

  useEffect(() => {
    if (status === 'idle') return
    const timeout = window.setTimeout(() => {
      setStatus('idle')
    }, COPY_STATUS_MS)
    return () => {
      window.clearTimeout(timeout)
    }
  }, [status])

  return (
    <div className="store-structure-address">
      <code title={url}>{url}</code>
      <Button
        title="Copy this node's address, to open it on its own or read it elsewhere"
        variant="ghost"
        onClick={() => {
          navigator.clipboard.writeText(url).then(
            () => {
              setStatus('copied')
            },
            () => {
              setStatus('failed')
            },
          )
        }}
      >
        {status === 'copied' ? 'Copied' : status === 'failed' ? 'Copy Failed' : 'Copy'}
      </Button>
    </div>
  )
}

function JsonBlock({
  title,
  value,
}: {
  readonly title?: string
  readonly value: unknown
}) {
  const json = formatJson(value)

  return (
    <div className="store-structure-json">
      {title === undefined ? null : <h4>{title}</h4>}
      <pre>{json.text}</pre>
      {json.cut ? (
        <p className="store-structure-empty">
          Showing the first {json.shown.toLocaleString()} of{' '}
          {json.length.toLocaleString()} characters.
        </p>
      ) : null}
    </div>
  )
}
