import { useId } from 'react'
import { Button, Disclosure, Drawer } from '../../components/ui'
import type { ParquetFileRef } from '../../data/parquetStructure'
import type {
  ZarrStructure,
  ZarrStructureNode,
  ZarrStructureNodeKind,
} from '../../zarr/zarrStructure'
import { ParquetFileView } from './ParquetStructureView'
import {
  formatBytes,
  formatCount,
  formatShape,
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
} from './storeStructureModel'
import {
  Fact,
  JsonBlock,
  NodeAddress,
  StructureAddress,
  StructureBrowser,
  type StructureNodeLabel,
} from './StructureBrowser'
import type { StoreStructureState, StoreStructureStore } from './useStoreStructure'

// The drawer of Browse Store and Browse File: the groups and arrays of the
// Zarr store, or the columns of the Parquet file, at the address in the
// dataset field, read without opening it as a dataset. A Parquet file in the
// store opens in its place, with a way back. It sits over the right of the
// canvas and is not modal.
export function StoreStructureDrawer({ store }: { readonly store: StoreStructureStore }) {
  const showingFile = store.view === 'file'

  return (
    <Drawer
      title={showingFile ? 'Parquet file' : 'Store structure'}
      side="right"
      open={store.open}
      onClose={store.close}
      className="store-structure-drawer"
    >
      {/* Both stay mounted, so going back keeps the store's open groups. */}
      <div className="store-structure-view" hidden={showingFile}>
        <StoreStructureView
          state={store.store}
          onRetry={store.retry}
          onBrowseFile={store.browseFile}
        />
      </div>
      <div className="store-structure-view" hidden={!showingFile}>
        <ParquetFileView
          state={store.file}
          onRetry={store.retry}
          {...(store.fileFromStore ? { onBack: store.back } : {})}
        />
      </div>
    </Drawer>
  )
}

export function StoreStructureView({
  state,
  onRetry,
  onBrowseFile,
}: {
  readonly state: StoreStructureState
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
          onBrowseFile={onBrowseFile}
        />
      )
  }
}

function ZarrStructureBrowser({
  structure,
  onBrowseFile,
}: {
  readonly structure: ZarrStructure
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
        <NodeDetails structure={structure} node={node} onBrowseFile={onBrowseFile} />
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
  onBrowseFile,
}: {
  readonly structure: ZarrStructure
  readonly node: ZarrStructureNode
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
