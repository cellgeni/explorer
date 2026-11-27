import { useId, useLayoutEffect, useRef } from 'react'
import { Button, Disclosure, Drawer } from '../../components/ui'
import type { ParquetFileRef } from '../../data/parquetStructure'
import type {
  ZarrArraySummary,
  ZarrStructure,
  ZarrStructureNode,
  ZarrStructureNodeKind,
} from '../../zarr/zarrStructure'
import type { ZarrValuePreview } from '../../zarr/zarrValuePreview'
import { H5FileView } from './H5StructureView'
import { ParquetFileView } from './ParquetStructureView'
import {
  formatBytes,
  formatCount,
  formatShape,
  formatZarrValue,
  initiallyExpanded,
  nodeRole,
  nodeSummary,
  nodeUrl,
  parquetFileOf,
  parquetNote,
  structureContentsLabel,
  structureFormatLabel,
  structureNotes,
  structureSourceLabel,
  zarrPreviewReadBound,
  zarrPreviewUnavailable,
} from './storeStructureModel'
import {
  Fact,
  JsonBlock,
  NodeAddress,
  StructureAddress,
  StructureBrowser,
  type StructureNodeLabel,
} from './StructureBrowser'
import type {
  ReadZarrValues,
  StoreStructureState,
  StoreStructureStore,
  StructureView,
} from './useStoreStructure'
import { ValuesPanel, ValuesTable } from './ValuesPanel'

const DRAWER_TITLES = {
  store: 'Store structure',
  file: 'Parquet file',
  h5: 'HDF5 file',
} as const

// The drawer of Browse Store and Browse File: the groups and arrays of the
// Zarr store, the columns of the Parquet file, or the groups and datasets of
// the HDF5 file, at the address in the dataset field, read without opening it
// as a dataset. A Parquet file in the store opens in its place, with a way
// back. It sits over the right of the canvas and is not modal.
export function StoreStructureDrawer({ store }: { readonly store: StoreStructureStore }) {
  const storeViewRef = useRef<HTMLDivElement>(null)
  const fileViewRef = useRef<HTMLDivElement>(null)
  const h5ViewRef = useRef<HTMLDivElement>(null)
  const shownViewRef = useRef(store.view)
  // Where focus was in each view when it was left, to go back to.
  const lastFocusRef = useRef<Partial<Record<StructureView, HTMLElement>>>({})

  // Browse File and Back to Store hide the view their button is in, which
  // would drop focus to the page (and Esc would no longer reach the drawer):
  // focus moves to the view shown, where it was when that view was left.
  useLayoutEffect(() => {
    const viewElement = (view: StructureView) =>
      (view === 'store' ? storeViewRef : view === 'file' ? fileViewRef : h5ViewRef)
        .current
    const left = shownViewRef.current
    shownViewRef.current = store.view
    if (left === store.view) return
    const active = document.activeElement
    if (
      !(active instanceof HTMLElement) ||
      viewElement(left)?.contains(active) !== true
    ) {
      return
    }

    lastFocusRef.current[left] = active
    const view = viewElement(store.view)
    const previous = lastFocusRef.current[store.view]
    ;(previous !== undefined && view?.contains(previous) === true
      ? previous
      : view
    )?.focus()
  }, [store.view])

  return (
    <Drawer
      title={DRAWER_TITLES[store.view]}
      side="right"
      open={store.open}
      onClose={store.close}
      className="store-structure-drawer"
    >
      {/* Both stay mounted, so going back keeps the store's open groups. */}
      <div
        ref={storeViewRef}
        className="store-structure-view"
        hidden={store.view !== 'store'}
        tabIndex={-1}
      >
        <StoreStructureView
          state={store.store}
          readValues={store.readValues}
          onRetry={store.retry}
          onBrowseFile={store.browseFile}
        />
      </div>
      <div
        ref={fileViewRef}
        className="store-structure-view"
        hidden={store.view !== 'file'}
        tabIndex={-1}
      >
        <ParquetFileView
          state={store.file}
          readRows={store.readRows}
          active={store.open && store.view === 'file'}
          onRetry={store.retry}
          {...(store.fileFromStore ? { onBack: store.back } : {})}
        />
      </div>
      <div
        ref={h5ViewRef}
        className="store-structure-view"
        hidden={store.view !== 'h5'}
        tabIndex={-1}
      >
        <H5FileView state={store.h5} onRetry={store.retry} />
      </div>
    </Drawer>
  )
}

export function StoreStructureView({
  state,
  readValues,
  onRetry,
  onBrowseFile,
}: {
  readonly state: StoreStructureState
  readonly readValues: ReadZarrValues
  readonly onRetry: () => void
  readonly onBrowseFile: (file: ParquetFileRef) => void
}) {
  switch (state.status) {
    case 'idle':
      return <p className="shell-drawer-empty">No store is open.</p>
    case 'loading':
      return (
        <div className="store-structure-status">
          <StructureAddress url={state.target} />
          <p role="status">
            {state.progress === 0
              ? 'Reading the store…'
              : `Reading the store… ${formatCount(state.progress, 'node')} read`}
          </p>
        </div>
      )
    case 'error':
      return (
        <div className="store-structure-status">
          <StructureAddress url={state.target} />
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
      return (
        <ZarrStructureBrowser
          key={state.target}
          structure={state.value}
          readValues={readValues}
          onBrowseFile={onBrowseFile}
        />
      )
  }
}

function ZarrStructureBrowser({
  structure,
  readValues,
  onBrowseFile,
}: {
  readonly structure: ZarrStructure
  readonly readValues: ReadZarrValues
  readonly onBrowseFile: (file: ParquetFileRef) => void
}) {
  const notes = structureNotes(structure)

  return (
    <StructureBrowser
      root={structure.root}
      initialExpanded={initiallyExpanded(structure)}
      treeLabel="Store contents"
      filterTitle="Show the groups, arrays and files whose name contains this text, or whose path does when the text has a /"
      describe={describeZarrNode}
      renderDetails={(node) => (
        <NodeDetails
          key={node.path}
          structure={structure}
          node={node}
          readValues={readValues}
          onBrowseFile={onBrowseFile}
        />
      )}
      header={
        <>
          <StructureAddress url={structure.url} />
          <dl className="store-structure-summary">
            <Fact label="Format">{structureFormatLabel(structure)}</Fact>
            <Fact label="Listed from">{structureSourceLabel(structure)}</Fact>
            {structure.conventions.length === 0 ? null : (
              <Fact label="Written as">{structure.conventions.join(', ')}</Fact>
            )}
            <Fact label="Contents">{structureContentsLabel(structure)}</Fact>
            {structure.zip === undefined ? null : (
              <Fact label="Zip">
                {formatCount(structure.zip.fileCount, 'file')},{' '}
                {formatBytes(structure.zip.bytes)}
                {structure.zip.root === '' ? null : (
                  <>
                    {' '}
                    in <code>{structure.zip.root}</code>
                  </>
                )}
              </Fact>
            )}
          </dl>
          {notes.map((note) => (
            <p key={note} className="store-structure-note">
              {note}
            </p>
          ))}
        </>
      }
    />
  )
}

const KIND_LABELS: Readonly<Record<ZarrStructureNodeKind, string>> = {
  group: 'Group',
  array: 'Array',
  folder: 'Folder',
  file: 'File',
}

function describeZarrNode(node: ZarrStructureNode): StructureNodeLabel {
  const role = nodeRole(node)

  return {
    icon: node.kind,
    kind: KIND_LABELS[node.kind],
    badges: [
      ...(role === null ? [] : [{ text: role }]),
      ...(node.unlisted === true ? [{ text: 'not listed', warning: true }] : []),
    ],
    meta: nodeSummary(node),
  }
}

function NodeDetails({
  structure,
  node,
  readValues,
  onBrowseFile,
}: {
  readonly structure: ZarrStructure
  readonly node: ZarrStructureNode
  readonly readValues: ReadZarrValues
  readonly onBrowseFile: (file: ParquetFileRef) => void
}) {
  const headingId = useId()
  const role = nodeRole(node)
  const url = nodeUrl(structure, node)
  const note = parquetNote(node)
  const parquetFile = parquetFileOf(structure, node)
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
      {parquetFile === null ? null : (
        <BrowseParquetFile node={node} file={parquetFile} onBrowseFile={onBrowseFile} />
      )}
      {url === null ? null : <NodeAddress url={url} />}
      {array === undefined ? null : (
        <ZarrValuesPanel
          structure={structure}
          node={node}
          array={array}
          readValues={readValues}
        />
      )}
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

// The array's first values: read at once when cheap, else on request.
function ZarrValuesPanel({
  structure,
  node,
  array,
  readValues,
}: {
  readonly structure: ZarrStructure
  readonly node: ZarrStructureNode
  readonly array: ZarrArraySummary
  readonly readValues: ReadZarrValues
}) {
  return (
    <ValuesPanel<ZarrValuePreview>
      unavailable={zarrPreviewUnavailable(array)}
      bound={zarrPreviewReadBound(array)}
      noun="array"
      source="store"
      read={(signal) => readValues(structure, node, signal)}
      renderValues={(preview, labelledBy) => (
        <ValuesTable
          shape={array.shape}
          preview={preview}
          labelledBy={labelledBy}
          noun="array"
          format={(value) => formatZarrValue(value, array.dtype)}
        />
      )}
    />
  )
}

function BrowseParquetFile({
  node,
  file,
  onBrowseFile,
}: {
  readonly node: ZarrStructureNode
  readonly file: ParquetFileRef
  readonly onBrowseFile: (file: ParquetFileRef) => void
}) {
  const name = file.zipPath ?? file.url
  const fileName = name.slice(name.lastIndexOf('/') + 1)

  return (
    <div className="store-structure-browse-file">
      <Button
        title={`Show the columns, row groups and metadata of ${fileName}`}
        onClick={() => {
          onBrowseFile(file)
        }}
      >
        Browse File
      </Button>
      {node.deflated === true && node.storedBytes !== undefined ? (
        <p className="store-structure-empty">
          The zip compresses this file, so reading its footer means downloading all of it
          ({formatBytes(node.storedBytes)} uncompressed).
        </p>
      ) : null}
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

  return Array.from(counts, ([kind, count]) =>
    formatCount(count, KIND_LABELS[kind].toLowerCase()),
  ).join(' · ')
}
