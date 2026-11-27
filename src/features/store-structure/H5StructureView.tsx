import { useId } from 'react'
import { Button } from '../../components/ui'
import type { H5Structure } from '../../data/h5Structure'
import {
  H5T_CLASS,
  type H5DatasetInfo,
  type H5StructureNode,
} from '../../data/h5StructureTypes'
import {
  formatH5Value,
  h5ByteOrderLabel,
  h5ChunkCount,
  h5Conventions,
  h5ContentsLabel,
  h5DecodedBytes,
  h5DtypeLabel,
  h5FilterLabel,
  h5KindLabel,
  h5MaxShapeLabel,
  h5NodeRole,
  h5NodeSummary,
  h5Notes,
  h5PreviewReadBound,
  h5PreviewUnavailable,
  h5ReadCostLabel,
  initiallyExpandedH5,
} from './h5StructureModel'
import { formatBytes, formatCount, formatShape } from './storeStructureModel'
import {
  Fact,
  JsonBlock,
  NodeAddress,
  StructureAddress,
  StructureBrowser,
  type StructureNodeLabel,
} from './StructureBrowser'
import type { H5FileState } from './useStoreStructure'
import { ValuesPanel, ValuesTable } from './ValuesPanel'

// The structure drawer's view of an HDF5 file (H5, H5AD, Loom): its groups and
// datasets as a tree, and for the selected dataset its type, shape, chunks,
// filters, attributes and first values.
export function H5FileView({
  state,
  onRetry,
}: {
  readonly state: H5FileState
  readonly onRetry: () => void
}) {
  switch (state.status) {
    case 'idle':
      return <p className="shell-drawer-empty">No file is open.</p>
    case 'loading':
      return (
        <div className="store-structure-status">
          <StructureAddress url={state.target} />
          <p role="status">
            {state.progress === 0
              ? 'Reading the file’s groups and datasets…'
              : `Reading the file’s groups and datasets… ${formatCount(state.progress, 'object')} read`}
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
            <Button title="Read the file again" onClick={onRetry}>
              Retry
            </Button>
          </div>
        </div>
      )
    case 'ready':
      return <H5StructureBrowser key={state.target} structure={state.value} />
  }
}

function H5StructureBrowser({ structure }: { readonly structure: H5Structure }) {
  const conventions = h5Conventions(structure)
  const notes = h5Notes(structure)
  const readCost = h5ReadCostLabel(structure)

  return (
    <StructureBrowser
      root={structure.root}
      initialExpanded={initiallyExpandedH5(structure)}
      treeLabel="File contents"
      filterTitle="Show the groups and datasets whose name contains this text, or whose path does when the text has a /"
      describe={describeH5Node}
      renderDetails={(node) => (
        <H5NodeDetails key={node.path} structure={structure} node={node} />
      )}
      header={
        <>
          <StructureAddress url={structure.url} />
          <dl className="store-structure-summary">
            <Fact label="Format">HDF5</Fact>
            {conventions.length === 0 ? null : (
              <Fact label="Written as">{conventions.join(', ')}</Fact>
            )}
            <Fact label="Contents">{h5ContentsLabel(structure)}</Fact>
            {structure.range === null ? null : (
              <Fact label="Size">{formatBytes(structure.range.size)}</Fact>
            )}
            {readCost === null ? null : <Fact label="Read">{readCost}</Fact>}
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

function describeH5Node(node: H5StructureNode): StructureNodeLabel {
  const role = h5NodeRole(node)

  return {
    icon:
      node.path === ''
        ? 'file'
        : node.kind === 'group'
          ? 'group'
          : node.kind === 'dataset'
            ? 'array'
            : node.kind === 'datatype'
              ? 'file'
              : 'link',
    kind: h5KindLabel(node),
    badges: [
      ...(role === null ? [] : [{ text: role }]),
      ...(node.kind === 'soft-link'
        ? [
            node.link?.enclosing === true
              ? { text: 'loop, not followed' }
              : { text: 'missing target', warning: true },
          ]
        : []),
      ...(node.unlisted === true ? [{ text: 'not listed', warning: true }] : []),
    ],
    meta: h5NodeSummary(node),
  }
}

function H5NodeDetails({
  structure,
  node,
}: {
  readonly structure: H5Structure
  readonly node: H5StructureNode
}) {
  const headingId = useId()
  const role = h5NodeRole(node)
  const attributes = Object.keys(node.attributes).length === 0 ? null : node.attributes
  const { dataset } = node

  return (
    <section className="store-structure-details" aria-labelledby={headingId}>
      <h3 id={headingId}>{node.name}</h3>
      <dl className="store-structure-facts">
        <Fact label="Path">
          <code>/{node.path}</code>
        </Fact>
        <Fact label="Kind">{h5KindLabel(node)}</Fact>
        {role === null ? null : <Fact label="Role">{role}</Fact>}
        {dataset === undefined ? null : <DatasetFacts dataset={dataset} />}
        {node.dtype === undefined ? null : (
          <Fact label="Data type">{h5DtypeLabel(node.dtype)}</Fact>
        )}
        {node.link === undefined ? null : (
          <>
            {node.link.file === undefined ? null : (
              <Fact label="File">
                <code>{node.link.file}</code>
              </Fact>
            )}
            <Fact label="Target">
              <code>{node.link.target}</code>
              {node.kind !== 'soft-link'
                ? null
                : node.link.enclosing === true
                  ? ', a group this link is in, so it is not followed'
                  : ' (missing)'}
            </Fact>
          </>
        )}
        {node.kind === 'group' ? (
          <Fact label="Holds">
            {childCounts(node)}
            {node.unlisted === true ? ' listed; there are more' : null}
          </Fact>
        ) : null}
      </dl>
      {node.path === '' ? <NodeAddress url={structure.url} /> : null}
      {dataset === undefined ? null : (
        <H5ValuesPanel structure={structure} node={node} dataset={dataset} />
      )}
      {attributes === null ? (
        <p className="store-structure-empty">No attributes.</p>
      ) : (
        <JsonBlock title="Attributes" value={attributes} />
      )}
      {node.skippedAttributes.length === 0 ? null : (
        <p className="store-structure-empty">
          Not shown:{' '}
          {node.skippedAttributes
            .map((attribute) => `${attribute.name} (${attribute.reason})`)
            .join('; ')}
          .
        </p>
      )}
    </section>
  )
}

function DatasetFacts({ dataset }: { readonly dataset: H5DatasetInfo }) {
  const byteOrder = h5ByteOrderLabel(dataset.dtype)
  const maxShape = h5MaxShapeLabel(dataset)
  const chunkCount = h5ChunkCount(dataset)
  const decoded = h5DecodedBytes(dataset)

  return (
    <>
      <Fact label="Shape">
        {dataset.shape === null ? 'No dataspace' : formatShape(dataset.shape)}
      </Fact>
      {maxShape === null ? null : <Fact label="Max shape">{maxShape}</Fact>}
      <Fact label="Data type">{h5DtypeLabel(dataset.dtype)}</Fact>
      {byteOrder === null ? null : <Fact label="Byte order">{byteOrder}</Fact>}
      <Fact label="Chunks">
        {dataset.chunks === null || chunkCount === null
          ? 'Not chunked'
          : `${formatShape(dataset.chunks)} · ${formatCount(chunkCount, 'chunk')}`}
      </Fact>
      <Fact label="Filters">
        {dataset.filters.length === 0
          ? 'None'
          : dataset.filters.map(h5FilterLabel).join(' → ')}
      </Fact>
      {decoded === null ? null : <Fact label="Decoded">{formatBytes(decoded)}</Fact>}
    </>
  )
}

const KIND_NOUNS: Readonly<Record<H5StructureNode['kind'], string>> = {
  group: 'group',
  dataset: 'dataset',
  datatype: 'datatype',
  'soft-link': 'link',
  'external-link': 'link',
}

function childCounts(node: H5StructureNode): string {
  if (node.children.length === 0) {
    return 'Nothing'
  }

  const counts = new Map<string, number>()

  for (const child of node.children) {
    const noun = KIND_NOUNS[child.kind]
    counts.set(noun, (counts.get(noun) ?? 0) + 1)
  }

  return Array.from(counts, ([noun, count]) => formatCount(count, noun)).join(' · ')
}

// The dataset's first values: read at once when cheap, else on request.
function H5ValuesPanel({
  structure,
  node,
  dataset,
}: {
  readonly structure: H5Structure
  readonly node: H5StructureNode
  readonly dataset: H5DatasetInfo
}) {
  const { dtype } = dataset
  const members =
    dtype.typeClass === H5T_CLASS.COMPOUND
      ? (dtype.members ?? []).map((member) => ({
          name: member.name,
          type: h5DtypeLabel(member.dtype),
        }))
      : null

  return (
    <ValuesPanel
      unavailable={h5PreviewUnavailable(dataset)}
      bound={h5PreviewReadBound(dataset)}
      noun="dataset"
      source="file"
      read={(signal) => structure.readValues(node.path, signal)}
      renderValues={(preview, labelledBy) => (
        <ValuesTable
          shape={dataset.shape ?? []}
          preview={preview}
          labelledBy={labelledBy}
          noun="dataset"
          columns={members}
          format={(value, column) =>
            formatH5Value(
              value,
              column === null ? dtype : (dtype.members?.[column]?.dtype ?? dtype),
            )
          }
        />
      )}
    />
  )
}
