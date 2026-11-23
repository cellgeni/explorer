import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { Button, ChevronRightIcon } from '../../components/ui'
import { classNames } from '../../components/ui/classNames'
import { formatCount, formatJson } from './storeStructureModel'
import {
  allBranchPaths,
  filterStructure,
  findNode,
  type StructureTreeNode,
} from './structureTree'

// The parts the structure drawer's Zarr, Parquet and HDF5 views share: a filtered
// tree beside the selected node's details.

export type StructureIconKind = 'group' | 'array' | 'folder' | 'file' | 'column' | 'link'

// How a node shows in the tree.
export interface StructureNodeLabel {
  readonly icon: StructureIconKind
  // Read before the name by screen readers, as "Array".
  readonly kind: string
  readonly badges: readonly { readonly text: string; readonly warning?: boolean }[]
  readonly meta: string
}

interface StructureBrowserProps<N extends StructureTreeNode<N>> {
  readonly root: N
  readonly initialExpanded: ReadonlySet<string>
  // Above the filter: the address and a summary.
  readonly header: ReactNode
  readonly treeLabel: string
  readonly filterTitle: string
  readonly describe: (node: N) => StructureNodeLabel
  readonly renderDetails: (node: N) => ReactNode
}

// Children shown at first under one group; more on request.
const CHILD_PAGE_SIZE = 200

export function StructureBrowser<N extends StructureTreeNode<N>>({
  root,
  initialExpanded,
  header,
  treeLabel,
  filterTitle,
  describe,
  renderDetails,
}: StructureBrowserProps<N>) {
  const filterId = useId()
  const [expanded, setExpanded] = useState(initialExpanded)
  const [selectedPath, setSelectedPath] = useState('')
  const [query, setQuery] = useState('')
  // Groups closed while a filter opens every match's ancestors.
  const [filterCollapsed, setFilterCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [childLimits, setChildLimits] = useState<ReadonlyMap<string, number>>(new Map())
  const filter = useMemo(() => filterStructure(root, query), [query, root])
  const selected = findNode(root, selectedPath) ?? root

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
        {header}
        <div className="store-structure-tools">
          <label className="visually-hidden" htmlFor={filterId}>
            Filter by name or path
          </label>
          <input
            id={filterId}
            type="search"
            className="store-structure-filter"
            placeholder="Filter by name or path"
            title={filterTitle}
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
              setExpanded(new Set(allBranchPaths(root)))
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
              setFilterCollapsed(new Set(allBranchPaths(root)))
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
        <ul aria-label={treeLabel}>
          <TreeItem
            node={root}
            depth={0}
            selectedPath={selected.path}
            visible={filter?.visible ?? null}
            isExpanded={isExpanded}
            childLimits={childLimits}
            describe={describe}
            onToggle={toggle}
            onSelect={setSelectedPath}
            onShowMore={(path, limit) => {
              setChildLimits((current) => new Map(current).set(path, limit))
            }}
          />
        </ul>
      </div>
      {renderDetails(selected)}
    </div>
  )
}

function toggled(set: ReadonlySet<string>, path: string): ReadonlySet<string> {
  const next = new Set(set)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  return next
}

interface TreeItemProps<N extends StructureTreeNode<N>> {
  readonly node: N
  readonly depth: number
  readonly selectedPath: string
  // Paths shown while filtering; null shows every node.
  readonly visible: ReadonlySet<string> | null
  readonly isExpanded: (path: string) => boolean
  readonly childLimits: ReadonlyMap<string, number>
  readonly describe: (node: N) => StructureNodeLabel
  readonly onToggle: (path: string) => void
  readonly onSelect: (path: string) => void
  readonly onShowMore: (path: string, limit: number) => void
}

function TreeItem<N extends StructureTreeNode<N>>(props: TreeItemProps<N>) {
  const { node, depth, selectedPath, visible, isExpanded, childLimits } = props
  const children =
    visible === null
      ? node.children
      : node.children.filter((child) => visible.has(child.path))
  const hasChildren = children.length > 0
  const open = hasChildren && isExpanded(node.path)
  const limit = childLimits.get(node.path) ?? CHILD_PAGE_SIZE
  const shown = children.slice(0, limit)
  const label = props.describe(node)
  const name = node.path === '' ? 'the root' : node.name
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
            aria-label={`${open ? 'Collapse' : 'Expand'} ${name}`}
            title={`${open ? 'Collapse' : 'Expand'} ${name}`}
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
          <NodeIcon kind={label.icon} label={label.kind} />
          <span className="store-structure-name">{node.name}</span>
          {label.badges.map((badge) => (
            <span
              key={badge.text}
              className={classNames(
                'store-structure-badge',
                badge.warning === true && 'is-warning',
              )}
            >
              {badge.text}
            </span>
          ))}
          <span className="store-structure-meta">{label.meta}</span>
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
                  title={`Show more of the ${children.length.toLocaleString()} items in ${name}`}
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

function NodeIcon({
  kind,
  label,
}: {
  readonly kind: StructureIconKind
  readonly label: string
}) {
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
        ) : kind === 'column' ? (
          <path d="M5.5 2.5h5v11h-5zM5.5 6.2h5M5.5 9.8h5" />
        ) : kind === 'link' ? (
          <path d="M7 9l2-2M6.2 5.4l1.3-1.3a2.3 2.3 0 0 1 3.3 3.3L9.5 8.7M9.8 10.6l-1.3 1.3a2.3 2.3 0 0 1-3.3-3.3l1.3-1.3" />
        ) : kind === 'file' ? (
          <path d="M4 1.8h5l3 3v9.4H4zM9 1.8v3h3" />
        ) : (
          <path
            d="M1.8 4.2v8.6h12.4V5.6H8L6.6 3.6H1.8z"
            strokeDasharray={kind === 'folder' ? '2 1.5' : undefined}
          />
        )}
      </svg>
      <span className="visually-hidden">{label}: </span>
    </>
  )
}

// The address a view was read from.
export function StructureAddress({ url }: { readonly url: string }) {
  return (
    <p className="store-structure-url" title={url}>
      {url}
    </p>
  )
}

export function Fact({
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

const COPY_STATUS_MS = 2000

export function NodeAddress({ url }: { readonly url: string }) {
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
        title="Copy this address, to open it on its own or read it elsewhere"
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

export function JsonBlock({
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
