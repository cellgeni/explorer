import { useId, useState, type ReactNode } from 'react'
import { Button } from '../../components/ui'
import type {
  ParquetFileRef,
  ParquetRowGroupSummary,
  ParquetSchemaNode,
  ParquetStructure,
} from '../../data/parquetStructure'
import {
  compressionLabel,
  formatStatValue,
  geoColumnFacts,
  initiallyExpandedParquet,
  keyValueText,
  parquetAnnotationLabel,
  parquetColumnRole,
  parquetContentsLabel,
  parquetConventions,
  parquetFieldLabel,
  parquetFormatLabel,
  parquetKindLabel,
  parquetNodeSummary,
  parquetPhysicalLabel,
  parquetTypeLabel,
} from './parquetStructureModel'
import { formatBytes, formatCount } from './storeStructureModel'
import {
  Fact,
  JsonBlock,
  NodeAddress,
  StructureAddress,
  StructureBrowser,
  type StructureNodeLabel,
} from './StructureBrowser'
import type { ParquetFileState } from './useStoreStructure'

// The structure drawer's view of one Parquet file: its schema as a tree, and
// for the selected column its type, compression and statistics, all from the
// file's footer.
export function ParquetFileView({
  state,
  onRetry,
  onBack,
}: {
  readonly state: ParquetFileState
  readonly onRetry: () => void
  // Set when the file was opened from a store's tree.
  readonly onBack?: () => void
}) {
  const back =
    onBack === undefined ? null : (
      <Button
        variant="ghost"
        className="store-structure-back"
        title="Return to the store's groups and arrays"
        onClick={onBack}
      >
        Back to Store
      </Button>
    )

  switch (state.status) {
    case 'idle':
      return (
        <div className="store-structure-status">
          {back}
          <p className="shell-drawer-empty">No file is open.</p>
        </div>
      )
    case 'loading':
      return (
        <div className="store-structure-status">
          {back}
          <FileAddress file={state.target} />
          <p role="status">Reading the file’s footer…</p>
        </div>
      )
    case 'error':
      return (
        <div className="store-structure-status">
          {back}
          <FileAddress file={state.target} />
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
      return (
        <ParquetStructureBrowser
          key={`${state.target.url}\n${state.target.zipPath ?? ''}`}
          structure={state.value}
          back={back}
        />
      )
  }
}

function FileAddress({ file }: { readonly file: ParquetFileRef }) {
  return (
    <>
      <StructureAddress url={file.url} />
      {file.zipPath === undefined ? null : (
        <p className="store-structure-zip-path">
          In the zip at <code>{file.zipPath}</code>
        </p>
      )}
    </>
  )
}

function ParquetStructureBrowser({
  structure,
  back,
}: {
  readonly structure: ParquetStructure
  readonly back: ReactNode
}) {
  const conventions = parquetConventions(structure)

  return (
    <StructureBrowser
      root={structure.root}
      initialExpanded={initiallyExpandedParquet(structure)}
      treeLabel="File columns"
      filterTitle="Show the columns and fields whose name contains this text, or whose path does when the text has a /"
      describe={(node) => describeParquetNode(structure, node)}
      renderDetails={(node) =>
        node.path === '' ? (
          <FileDetails structure={structure} />
        ) : (
          <FieldDetails structure={structure} node={node} />
        )
      }
      header={
        <>
          {back}
          <FileAddress file={structure.ref} />
          <dl className="store-structure-summary">
            <Fact label="Format">{parquetFormatLabel(structure)}</Fact>
            {structure.createdBy === null ? null : (
              <Fact label="Written by">{structure.createdBy}</Fact>
            )}
            {conventions.length === 0 ? null : (
              <Fact label="Written as">{conventions.join(', ')}</Fact>
            )}
            <Fact label="Contents">{parquetContentsLabel(structure)}</Fact>
            <Fact label="Size">
              {formatBytes(structure.byteLength)}, of which the footer is{' '}
              {formatBytes(structure.footerBytes)}
            </Fact>
          </dl>
        </>
      }
    />
  )
}

function describeParquetNode(
  structure: ParquetStructure,
  node: ParquetSchemaNode,
): StructureNodeLabel {
  const role = parquetColumnRole(structure, node)

  return {
    icon: node.path === '' ? 'file' : node.children.length > 0 ? 'group' : 'column',
    kind: parquetKindLabel(node),
    badges: role === null ? [] : [{ text: role }],
    meta: parquetNodeSummary(node),
  }
}

function FileDetails({ structure }: { readonly structure: ParquetStructure }) {
  const headingId = useId()
  const { root } = structure
  const nested = root.children.length !== structure.columnCount

  return (
    <section className="store-structure-details" aria-labelledby={headingId}>
      <h3 id={headingId}>{root.name}</h3>
      <dl className="store-structure-facts">
        <Fact label="Kind">{parquetKindLabel(root)}</Fact>
        <Fact label="Schema root">
          <code>{root.element.name}</code>
        </Fact>
        <Fact label="Rows">{structure.rowCount.toLocaleString()}</Fact>
        <Fact label="Columns">
          {structure.columnCount.toLocaleString()}
          {nested ? ` in ${formatCount(root.children.length, 'top-level field')}` : null}
        </Fact>
        <Fact label="Data">
          {compressionLabel(structure.compressedBytes, structure.uncompressedBytes)}
        </Fact>
      </dl>
      {structure.ref.zipPath === undefined ? (
        <NodeAddress url={structure.ref.url} />
      ) : null}
      <RowGroupTable rowGroups={structure.rowGroups} />
      <div className="store-structure-key-values">
        <h4>Key-value metadata</h4>
        {structure.keyValueMetadata.length === 0 ? (
          <p className="store-structure-empty">None.</p>
        ) : (
          structure.keyValueMetadata.map((entry) => {
            if (entry.json !== undefined) {
              return <JsonBlock key={entry.key} title={entry.key} value={entry.json} />
            }

            const { text, note } = keyValueText(entry)

            return (
              <div key={entry.key} className="store-structure-json">
                <h4>{entry.key}</h4>
                {text === '' ? null : <pre>{text}</pre>}
                {note === null ? null : <p className="store-structure-empty">{note}</p>}
              </div>
            )
          })
        )}
      </div>
    </section>
  )
}

// Row groups listed at first; more on request.
const ROW_GROUP_PAGE_SIZE = 100

function RowGroupTable({
  rowGroups,
}: {
  readonly rowGroups: readonly ParquetRowGroupSummary[]
}) {
  const headingId = useId()
  const [limit, setLimit] = useState(ROW_GROUP_PAGE_SIZE)
  const shown = rowGroups.slice(0, limit)

  return (
    <div className="store-structure-row-groups">
      <h4 id={headingId}>Row groups</h4>
      {rowGroups.length === 0 ? (
        <p className="store-structure-empty">None; the file holds no rows.</p>
      ) : (
        <table className="store-structure-table" aria-labelledby={headingId}>
          <thead>
            <tr>
              <th scope="col">Group</th>
              <th scope="col">Rows</th>
              <th scope="col">Compressed</th>
              <th scope="col">Uncompressed</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((group, index) => (
              <tr key={index}>
                <td>{index}</td>
                <td>{group.rowCount.toLocaleString()}</td>
                <td>{formatBytes(group.compressedBytes)}</td>
                <td>{formatBytes(group.uncompressedBytes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {shown.length < rowGroups.length ? (
        <Button
          title={`List more of the ${rowGroups.length.toLocaleString()} row groups`}
          variant="ghost"
          className="store-structure-more"
          onClick={() => {
            setLimit((current) => current + ROW_GROUP_PAGE_SIZE * 5)
          }}
        >
          Show More ({(rowGroups.length - shown.length).toLocaleString()} hidden)
        </Button>
      ) : null}
    </div>
  )
}

function FieldDetails({
  structure,
  node,
}: {
  readonly structure: ParquetStructure
  readonly node: ParquetSchemaNode
}) {
  const headingId = useId()
  const { element, column } = node
  const role = parquetColumnRole(structure, node)
  const annotation = parquetAnnotationLabel(element)
  const physical = parquetPhysicalLabel(element)
  const geo = geoColumnFacts(structure, node)
  const leaves = column === undefined ? leafColumns(node) : []

  return (
    <section className="store-structure-details" aria-labelledby={headingId}>
      <h3 id={headingId}>{node.name}</h3>
      <dl className="store-structure-facts">
        <Fact label="Path">
          <code>{parquetFieldLabel(node)}</code>
        </Fact>
        <Fact label="Kind">{parquetKindLabel(node)}</Fact>
        {role === null ? null : <Fact label="Role">{role}</Fact>}
        <Fact label="Type">{parquetTypeLabel(element)}</Fact>
        {physical === null ? null : <Fact label="Stored as">{physical}</Fact>}
        {annotation === null ? null : <Fact label="Annotation">{annotation}</Fact>}
        {element.repetition_type === undefined ? null : (
          <Fact label="Repetition">{element.repetition_type.toLowerCase()}</Fact>
        )}
        {element.field_id === undefined ? null : (
          <Fact label="Field ID">{element.field_id}</Fact>
        )}
        {column === undefined ? (
          <>
            <Fact label="Holds">{formatCount(node.children.length, 'field')}</Fact>
            <Fact label="Data">
              {compressionLabel(
                sum(leaves, (leaf) => leaf.compressedBytes),
                sum(leaves, (leaf) => leaf.uncompressedBytes),
              )}{' '}
              in {formatCount(leaves.length, 'column')}
            </Fact>
          </>
        ) : (
          <>
            <Fact label="Compression">{column.codecs.join(', ') || 'None'}</Fact>
            <Fact label="Encodings">{column.encodings.join(', ') || 'None'}</Fact>
            <Fact label="Data">
              {compressionLabel(column.compressedBytes, column.uncompressedBytes)}
            </Fact>
            <Fact label="Values">{column.valueCount.toLocaleString()}</Fact>
            {column.nullCount === undefined ? null : (
              <Fact label="Nulls">{column.nullCount.toLocaleString()}</Fact>
            )}
            {column.min === undefined ? null : (
              <Fact label="Minimum">{formatStatValue(column.min)}</Fact>
            )}
            {column.max === undefined ? null : (
              <Fact label="Maximum">{formatStatValue(column.max)}</Fact>
            )}
            <Fact label="Dictionary">{column.dictionary ? 'Yes' : 'No'}</Fact>
            <Fact label="Indexes">
              {[
                ...(column.pageIndex ? ['page index'] : []),
                ...(column.bloomFilter ? ['bloom filter'] : []),
              ].join(', ') || 'None'}
            </Fact>
          </>
        )}
        {geo === null ? null : (
          <>
            {geo.encoding === null ? null : (
              <Fact label="Geometry encoding">{geo.encoding}</Fact>
            )}
            <Fact label="Geometry types">
              {geo.geometryTypes.length === 0
                ? 'Any (none listed)'
                : geo.geometryTypes.join(', ')}
            </Fact>
            <Fact label="CRS">{geo.crs}</Fact>
            {geo.bbox === null ? null : <Fact label="Bounding box">{geo.bbox}</Fact>}
            {geo.primary ? (
              <Fact label="Primary">Yes, the file’s main geometry</Fact>
            ) : null}
          </>
        )}
      </dl>
      {typeof column?.min === 'string' || typeof column?.max === 'string' ? (
        <p className="store-structure-empty">
          The minimum and maximum come from each row group’s statistics, which some
          writers shorten for long text.
        </p>
      ) : null}
    </section>
  )
}

function leafColumns(
  node: ParquetSchemaNode,
): NonNullable<ParquetSchemaNode['column']>[] {
  return node.column === undefined ? node.children.flatMap(leafColumns) : [node.column]
}

function sum<T>(items: readonly T[], value: (item: T) => number): number {
  return items.reduce((total, item) => total + value(item), 0)
}
