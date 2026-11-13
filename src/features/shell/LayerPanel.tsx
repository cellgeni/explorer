import { useId, type ReactNode } from 'react'
import { Button, ChevronRightIcon, Disclosure, IconButton } from '../../components/ui'
import { classNames } from '../../components/ui/classNames'
import {
  AnnotationLabelLists,
  AnnotationSetControls,
  GeometricShapesPanel,
  MetadataTracksPanel,
} from '../sections/AnnotationsSectionBlocks'
import type { AnnotationsSectionModel } from '../sections/annotationsSectionModel'
import { SelectionListPanel } from '../sections/SelectionListBlock'
import {
  CellBoundaryToggles,
  CellColorControls,
  CellOpacityControls,
  ExpressionDetailControl,
  GeneExpressionControls,
  GenePicker,
} from '../sections/CellsSectionBlocks'
import type { CellsSectionModel } from '../sections/cellsSectionModel'
import {
  VisiumHdBinControls,
  VisiumOffTissueToggle,
  VisiumTissueImageSelect,
} from '../sections/DatasetInfoBlocks'
import type { DatasetViewOptionsModel } from '../sections/datasetInfoModel'
import {
  CustomImageLayers,
  ImageChannelControls,
  ImageOpacityControl,
  ImageZPlaneControl,
} from '../sections/ImageSectionBlocks'
import type { ImageSectionModel } from '../sections/imageSectionModel'
import {
  TranscriptBudget,
  TranscriptColourControls,
  TranscriptDetails,
  TranscriptDisplayControls,
  TranscriptFeatureControls,
  TranscriptFilterControls,
  TranscriptPointStyleControls,
} from '../sections/TranscriptsSectionBlocks'
import type { TranscriptsSectionModel } from '../sections/transcriptsSectionModel'
import { TranscriptGeneList } from '../sections/TranscriptGeneListBlock'
import type {
  LayerPanelModel,
  LayerSectionHeader,
  LayerSectionId,
} from './layerPanelModel'
import { defaultExpandedSections } from './shellLinkModel'

interface LayerPanelProps {
  readonly panel: LayerPanelModel
  readonly collapsed: boolean
  readonly onCollapsedChange: (collapsed: boolean) => void
  readonly image: ImageSectionModel
  readonly cells: CellsSectionModel
  readonly transcripts: TranscriptsSectionModel
  readonly annotations: AnnotationsSectionModel
  // Visium HD bin size, the Visium tissue image and off-tissue spots.
  readonly viewOptions: DatasetViewOptionsModel
  // The open sections, or null for the default (15.2-H keeps them in the
  // link).
  readonly expanded: readonly LayerSectionId[] | null
  readonly onExpandedChange: (expanded: readonly LayerSectionId[]) => void
  // Cells › Show Embedding opens the Embedding panel (15.2-G).
  readonly embeddingOpen: boolean
  readonly onEmbeddingOpenChange: (open: boolean) => void
  // Under 860 px the panel is a bottom sheet (15.2-I): a handle that names
  // what colours the cells, instead of the collapse button.
  readonly sheet?: LayerSheetProps | undefined
}

export interface LayerSheetProps {
  readonly expanded: boolean
  readonly onExpandedChange: (expanded: boolean) => void
  readonly summary?: string | undefined
}

// The layer panel (plan 15.2-C): Image, Cells (Spots or Bins),
// Transcripts and Annotations. Sections stay mounted while closed, and so do
// they while the panel is collapsed, so a gene search survives.
export function LayerPanel({
  panel,
  collapsed,
  onCollapsedChange,
  image,
  cells,
  transcripts,
  annotations,
  viewOptions,
  expanded: chosenExpanded,
  onExpandedChange,
  embeddingOpen,
  onEmbeddingOpenChange,
  sheet,
}: LayerPanelProps) {
  const bodyId = useId()
  // Until the user opens or closes a section, Cells is open, or Image where
  // there are no cells.
  const expanded = new Set<LayerSectionId>(
    chosenExpanded ??
      defaultExpandedSections(panel.sections.some((section) => section.id === 'cells')),
  )
  const bodies: Readonly<Record<LayerSectionId, ReactNode>> = {
    image: <ImageSection image={image} viewOptions={viewOptions} />,
    cells: (
      <CellsSection
        cells={cells}
        annotations={annotations}
        viewOptions={viewOptions}
        embeddingOpen={embeddingOpen}
        onEmbeddingOpenChange={onEmbeddingOpenChange}
      />
    ),
    transcripts: <TranscriptsSection transcripts={transcripts} />,
    annotations: (
      <div className="analysis-section">
        <SelectionListPanel selections={annotations.selections} />
        <GeometricShapesPanel shapes={annotations.shapes} />
      </div>
    ),
  }

  const sections = panel.sections.map((header) => (
    <LayerSection
      key={header.id}
      header={header}
      expanded={expanded.has(header.id)}
      onExpandedChange={(open) => {
        onExpandedChange(
          panel.sections
            .map((section) => section.id)
            .filter((id) => (id === header.id ? open : expanded.has(id))),
        )
      }}
    >
      {bodies[header.id]}
    </LayerSection>
  ))

  // One tree for both, so crossing 860 px keeps each section's state, such
  // as a gene search (15.5-B); only the header differs.
  return (
    <aside
      className={classNames(
        sheet === undefined ? 'shell-layer-panel' : 'ui-sheet shell-layer-sheet',
        sheet === undefined
          ? collapsed && 'is-collapsed'
          : sheet.expanded && 'is-expanded',
      )}
      aria-label="Layers"
    >
      {sheet === undefined ? (
        <header className="shell-layer-panel-header">
          {collapsed ? null : <h2>Layers</h2>}
          <IconButton
            title={collapsed ? 'Show layers (\\)' : 'Hide layers (\\)'}
            icon={<ChevronRightIcon />}
            aria-expanded={!collapsed}
            aria-controls={bodyId}
            className="shell-layer-panel-toggle"
            onClick={() => {
              onCollapsedChange(!collapsed)
            }}
          />
        </header>
      ) : (
        <h2 className="shell-layer-sheet-heading">
          <button
            type="button"
            className="ui-sheet-handle"
            title={sheet.expanded ? 'Collapse Layers' : 'Expand Layers'}
            aria-expanded={sheet.expanded}
            aria-controls={bodyId}
            onClick={() => {
              sheet.onExpandedChange(!sheet.expanded)
            }}
          >
            <span className="ui-sheet-grip" aria-hidden="true" />
            <span className="ui-sheet-title">Layers</span>
            {sheet.summary === undefined ? null : (
              <span className="ui-sheet-summary">{sheet.summary}</span>
            )}
          </button>
        </h2>
      )}
      <div
        id={bodyId}
        className={classNames(
          'shell-layer-sections',
          sheet !== undefined && 'ui-sheet-body',
        )}
        hidden={sheet === undefined ? collapsed : !sheet.expanded}
      >
        {sections}
      </div>
    </aside>
  )
}

function LayerSection({
  header,
  expanded,
  onExpandedChange,
  children,
}: {
  readonly header: LayerSectionHeader
  readonly expanded: boolean
  readonly onExpandedChange: (expanded: boolean) => void
  readonly children: ReactNode
}) {
  const buttonId = useId()
  const regionId = useId()

  return (
    <section
      className={
        header.visible ? 'shell-layer-section' : 'shell-layer-section is-layer-hidden'
      }
    >
      <div className="shell-layer-section-header">
        <input
          type="checkbox"
          checked={header.visible}
          disabled={header.visibilityDisabled}
          aria-label={`Show ${header.title}`}
          title={`Show ${header.title}`}
          onChange={(event) => {
            header.onVisibleChange(event.currentTarget.checked)
          }}
        />
        <h3>
          <button
            id={buttonId}
            type="button"
            aria-expanded={expanded}
            aria-controls={regionId}
            title={expanded ? `Close ${header.title}` : `Open ${header.title}`}
            onClick={() => {
              onExpandedChange(!expanded)
            }}
          >
            <span className="shell-layer-section-name">{header.title}</span>
            <span className="shell-layer-section-summary">{header.summary}</span>
            {header.loading ? (
              <span className="shell-loading-dot" role="img" aria-label="Loading" />
            ) : null}
            <ChevronRightIcon />
          </button>
        </h3>
      </div>
      <div
        id={regionId}
        role="region"
        aria-labelledby={buttonId}
        className="shell-layer-section-body"
        hidden={!expanded}
      >
        {children}
      </div>
    </section>
  )
}

function SubHeading({ children }: { readonly children: string }) {
  return <h4 className="shell-subheading">{children}</h4>
}

function ImageSection({
  image,
  viewOptions,
}: {
  readonly image: ImageSectionModel
  readonly viewOptions: DatasetViewOptionsModel
}) {
  return (
    <>
      <div className="layer-opacity-controls">
        <ImageOpacityControl image={image} />
        <ImageZPlaneControl image={image} />
      </div>
      <VisiumTissueImageSelect visium={viewOptions.visium} />
      <ImageChannelControls image={image} />
      <CustomImageLayers layers={image.customLayers} />
    </>
  )
}

function CellsSection({
  cells,
  annotations,
  viewOptions,
  embeddingOpen,
  onEmbeddingOpenChange,
}: {
  readonly cells: CellsSectionModel
  readonly annotations: AnnotationsSectionModel
  readonly viewOptions: DatasetViewOptionsModel
  readonly embeddingOpen: boolean
  readonly onEmbeddingOpenChange: (open: boolean) => void
}) {
  return (
    <>
      <SubHeading>Appearance</SubHeading>
      <div className="boundary-layer-toggles">
        <CellBoundaryToggles appearance={cells.appearance} />
        <VisiumOffTissueToggle visium={viewOptions.visium} />
      </div>
      <div className="layer-opacity-controls">
        <CellOpacityControls appearance={cells.appearance} />
      </div>
      <VisiumHdBinControls visiumHd={viewOptions.visiumHd} />

      {/* The gene and annotation blocks take the shared field styles. */}
      <div className="analysis-section">
        <SubHeading>Colour by</SubHeading>
        <CellColorControls colour={cells.colour} />

        <SubHeading>Genes</SubHeading>
        <GenePicker genes={cells.genes} />
        <GeneExpressionControls colour={cells.colour} />
        <p className="analysis-status" aria-live="polite">
          {cells.colour.statusCopy}
        </p>

        <SubHeading>Clusters</SubHeading>
        <AnnotationSetControls sets={annotations.sets} />
        <AnnotationLabelLists sets={annotations.sets} />
        <MetadataTracksPanel metadataTracks={annotations.metadataTracks} />

        <SubHeading>Embedding</SubHeading>
        <Button
          title={
            embeddingOpen ? 'Hide the embedding panel' : 'Show the UMAP or t-SNE panel'
          }
          aria-pressed={embeddingOpen}
          onClick={() => {
            onEmbeddingOpenChange(!embeddingOpen)
          }}
        >
          {embeddingOpen ? 'Hide Embedding' : 'Show Embedding'}
        </Button>

        <Disclosure title="Advanced cell options" summary="Advanced">
          <ExpressionDetailControl colour={cells.colour} />
        </Disclosure>
      </div>
    </>
  )
}

function TranscriptsSection({
  transcripts,
}: {
  readonly transcripts: TranscriptsSectionModel
}) {
  return (
    <div className="analysis-section transcript-section">
      <TranscriptDisplayControls transcripts={transcripts} />

      <SubHeading>Genes</SubHeading>
      <TranscriptFeatureControls features={transcripts.features} />
      <TranscriptGeneList geneLegend={transcripts.geneLegend} />

      <SubHeading>Appearance</SubHeading>
      <TranscriptColourControls transcripts={transcripts} />
      <TranscriptPointStyleControls transcripts={transcripts} />

      <SubHeading>Filters</SubHeading>
      <TranscriptFilterControls transcripts={transcripts} />

      <Disclosure title="Advanced transcript options" summary="Advanced">
        <TranscriptBudget transcripts={transcripts} />
      </Disclosure>

      {/* The pinned transcript is in the Transcript card (15.2-D). */}
      <TranscriptDetails transcripts={transcripts} showInspection={false} />
    </div>
  )
}
