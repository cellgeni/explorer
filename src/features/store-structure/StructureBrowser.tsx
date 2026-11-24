import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
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
  const treeRef = useRef<HTMLUListElement>(null)
  const [expanded, setExpanded] = useState(initialExpanded)
  const [selectedPath, setSelectedPath] = useState('')
  // The row that is the tree's one tab stop, by its key.
  const [focusKey, setFocusKey] = useState('')
  // A row to focus once it is drawn: the first that Show More adds, as Show
  // More's own row then goes.
  const pendingFocusKeyRef = useRef<string | null>(null)
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

  const visible = filter?.visible ?? null
  const shownKeys = shownRowKeys(root, visible, isExpanded, childLimits)
  // The focused row, else the selected one, else the root, so the tree
  // always has its tab stop.
  const tabStopKey = shownKeys.has(focusKey)
    ? focusKey
    : shownKeys.has(selected.path)
      ? selected.path
      : ''

  useEffect(() => {
    const key = pendingFocusKeyRef.current
    if (key === null) return
    pendingFocusKeyRef.current = null
    treeRows(treeRef.current)
      .find((row) => row.dataset.key === key)
      ?.focus()
  }, [childLimits])

  // Arrow keys move between rows, Right and Left open and close groups,
  // Enter and Space show a row's details (or more rows), as in a file tree.
  const handleKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const rows = treeRows(treeRef.current)
    const row =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>('[role="treeitem"]')
        : null
    if (row === null) return
    const index = rows.indexOf(row)
    const path = row.dataset.path
    const expandedState = row.getAttribute('aria-expanded')
    let target: HTMLElement | undefined

    switch (event.key) {
      case 'ArrowDown':
        target = rows[index + 1]
        break
      case 'ArrowUp':
        target = rows[index - 1]
        break
      case 'Home':
        target = rows[0]
        break
      case 'End':
        target = rows.at(-1)
        break
      case 'ArrowRight':
        if (expandedState === 'false' && path !== undefined) toggle(path)
        else if (expandedState === 'true') target = rows[index + 1]
        break
      case 'ArrowLeft':
        if (expandedState === 'true' && path !== undefined) toggle(path)
        else target = parentRow(row)
        break
      case 'Enter':
      case ' ':
        row.click()
        break
      default:
        return
    }

    event.preventDefault()
    target?.focus()
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
              setFilterCollapsed(
                new Set(allBranchPaths(root).filter((path) => path !== '')),
              )
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
        <ul
          ref={treeRef}
          role="tree"
          aria-label={treeLabel}
          onKeyDown={handleKeyDown}
          onFocus={(event) => {
            const key =
              event.target instanceof HTMLElement ? event.target.dataset.key : undefined
            if (key !== undefined) setFocusKey(key)
          }}
        >
          <TreeItem
            node={root}
            depth={0}
            selectedPath={selected.path}
            tabStopKey={tabStopKey}
            visible={visible}
            isExpanded={isExpanded}
            childLimits={childLimits}
            describe={describe}
            onToggle={toggle}
            onSelect={setSelectedPath}
            onShowMore={(path, limit, firstAdded) => {
              pendingFocusKeyRef.current = firstAdded
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

// A row's key: its node's path, or the path of the group whose Show More it is.
function moreRowKey(path: string): string {
  return `\u0000more:${path}`
}

function shownChildren<N extends StructureTreeNode<N>>(
  node: N,
  visible: ReadonlySet<string> | null,
): readonly N[] {
  return visible === null
    ? node.children
    : node.children.filter((child) => visible.has(child.path))
}

// The keys of the rows drawn, as TreeItem draws them.
function shownRowKeys<N extends StructureTreeNode<N>>(
  root: N,
  visible: ReadonlySet<string> | null,
  isExpanded: (path: string) => boolean,
  childLimits: ReadonlyMap<string, number>,
): ReadonlySet<string> {
  const keys = new Set<string>()
  const visit = (node: N) => {
    keys.add(node.path)
    const children = shownChildren(node, visible)
    if (children.length === 0 || !isExpanded(node.path)) return
    const limit = childLimits.get(node.path) ?? CHILD_PAGE_SIZE
    children.slice(0, limit).forEach(visit)
    if (limit < children.length) keys.add(moreRowKey(node.path))
  }
  visit(root)
  return keys
}

function treeRows(tree: HTMLElement | null): HTMLElement[] {
  return tree === null
    ? []
    : Array.from(tree.querySelectorAll<HTMLElement>('[role="treeitem"]'))
}

// The row of the group a row is in: rows sit in a <li> beside their group.
function parentRow(row: HTMLElement): HTMLElement | undefined {
  const parent = row.closest('[role="group"]')?.parentElement?.firstElementChild
  return parent instanceof HTMLElement && parent.getAttribute('role') === 'treeitem'
    ? parent
    : undefined
}

interface TreeItemProps<N extends StructureTreeNode<N>> {
  readonly node: N
  readonly depth: number
  readonly selectedPath: string
  readonly tabStopKey: string
  // Paths shown while filtering; null shows every node.
  readonly visible: ReadonlySet<string> | null
  readonly isExpanded: (path: string) => boolean
  readonly childLimits: ReadonlyMap<string, number>
  readonly describe: (node: N) => StructureNodeLabel
  readonly onToggle: (path: string) => void
  readonly onSelect: (path: string) => void
  readonly onShowMore: (path: string, limit: number, firstAdded: string) => void
}

function TreeItem<N extends StructureTreeNode<N>>(props: TreeItemProps<N>) {
  const { node, depth, selectedPath, tabStopKey, visible, isExpanded, childLimits } =
    props
  const children = shownChildren(node, visible)
  const hasChildren = children.length > 0
  const open = hasChildren && isExpanded(node.path)
  const limit = childLimits.get(node.path) ?? CHILD_PAGE_SIZE
  const shown = children.slice(0, limit)
  const label = props.describe(node)
  const name = node.path === '' ? 'the root' : node.name
  const isSelected = node.path === selectedPath
  const moreKey = moreRowKey(node.path)
  const firstHidden = children[shown.length]

  return (
    <li role="none">
      <div
        role="treeitem"
        className={classNames('store-structure-row', isSelected && 'is-selected')}
        style={{ paddingLeft: `${depth * 14}px` }}
        data-key={node.path}
        data-path={node.path}
        aria-level={depth + 1}
        aria-expanded={hasChildren ? open : undefined}
        aria-selected={isSelected}
        tabIndex={tabStopKey === node.path ? 0 : -1}
        title={`Show details of ${node.path === '' ? '/' : node.path}`}
        onClick={() => {
          props.onSelect(node.path)
        }}
      >
        {hasChildren ? (
          // The keyboard opens groups with Right and Left; this is for the mouse.
          <span
            className="store-structure-toggle"
            aria-hidden="true"
            title={`${open ? 'Collapse' : 'Expand'} ${name}`}
            onClick={(event) => {
              event.stopPropagation()
              props.onToggle(node.path)
            }}
          >
            <ChevronRightIcon />
          </span>
        ) : (
          <span className="store-structure-toggle" aria-hidden="true" />
        )}
        <span className="store-structure-node">
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
        </span>
      </div>
      {open ? (
        <ul role="group">
          {shown.map((child) => (
            <TreeItem key={child.path} {...props} node={child} depth={depth + 1} />
          ))}
          {firstHidden === undefined ? null : (
            <li role="none">
              <div
                role="treeitem"
                className="store-structure-row store-structure-more"
                style={{ paddingLeft: `${(depth + 1) * 14}px` }}
                data-key={moreKey}
                aria-level={depth + 2}
                tabIndex={tabStopKey === moreKey ? 0 : -1}
                title={`Show more of the ${children.length.toLocaleString()} items in ${name}`}
                onClick={() => {
                  props.onShowMore(
                    node.path,
                    limit + CHILD_PAGE_SIZE * 5,
                    firstHidden.path,
                  )
                }}
              >
                <span className="store-structure-toggle" aria-hidden="true" />
                <span className="store-structure-node">
                  Show More ({(children.length - shown.length).toLocaleString()} hidden)
                </span>
              </div>
            </li>
          )}
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
