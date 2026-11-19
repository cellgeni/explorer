import { useEffect, useEffectEvent, useId, useRef, type ReactNode } from 'react'
import { ChevronRightIcon, Disclosure, IconButton } from '../../components/ui'
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
  MerscopeImageSelect,
  AteraImageSelect,
  VisiumTissueImageSelect,
} from '../sections/DatasetInfoBlocks'
import type { DatasetViewOptionsModel } from '../sections/datasetInfoModel'
import {
  CustomImageLayers,
  ImageChannelControls,
  ImageOpacityControl,
  ImageVolumeViewControl,
  ImageZPlaneControl,
} from '../sections/ImageSectionBlocks'
import type { ImageSectionModel } from '../sections/imageSectionModel'
import { SegmentationPanel } from '../sections/SegmentationSectionBlocks'
import type { SegmentationSectionModel } from '../sections/segmentationSectionModel'
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
  LayerAnchor,
  LayerPanelModel,
  LayerReveal,
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
  // An image's imported segmentation; its section shows where the panel
  // model lists it.
  readonly segmentation?: SegmentationSectionModel | null | undefined
  // Visium HD bin size, the Visium tissue image and off-tissue spots.
  readonly viewOptions: DatasetViewOptionsModel
  // The open sections, or null for the default (15.2-H keeps them in the
  // link).
  readonly expanded: readonly LayerSectionId[] | null
  readonly onExpandedChange: (expanded: readonly LayerSectionId[]) => void
  // Under 860 px the panel is a bottom sheet (15.2-I): a handle that names
  // what colours the cells, instead of the collapse button.
  readonly sheet?: LayerSheetProps | undefined
  // Brings a section, or a part of one, into view.
  readonly reveal?: LayerReveal | null | undefined
}

export interface LayerSheetProps {
  readonly expanded: boolean
  readonly onExpandedChange: (expanded: boolean) => void
  readonly summary?: string | undefined
}

// The layer panel (plan 15.2-C): Image, Cells (Spots or Bins), Segmentation
// (an image's imported outlines), Transcripts and Annotations. Sections stay mounted while closed, and so do
// they while the panel is collapsed, so a gene search survives.
export function LayerPanel({
  panel,
  collapsed,
  onCollapsedChange,
  image,
  cells,
  transcripts,
  annotations,
  segmentation = null,
  viewOptions,
  expanded: chosenExpanded,
  onExpandedChange,
  sheet,
  reveal = null,
}: LayerPanelProps) {
  const bodyId = useId()
  const panelRef = useRef<HTMLElement>(null)
  const pendingRevealRef = useRef<LayerReveal | null>(null)
  // Until the user opens or closes a section, Cells is open, or Image where
  // there are no cells.
  const expanded = new Set<LayerSectionId>(
    chosenExpanded ??
      defaultExpandedSections(panel.sections.some((section) => section.id === 'cells')),
  )
  const bodies: Readonly<Record<LayerSectionId, ReactNode>> = {
    image: <ImageSection image={image} viewOptions={viewOptions} />,
    cells: (
      <CellsSection cells={cells} annotations={annotations} viewOptions={viewOptions} />
    ),
    segmentation:
      segmentation === null ? null : <SegmentationPanel segmentation={segmentation} />,
    transcripts: <TranscriptsSection transcripts={transcripts} />,
    annotations: (
      <div className="analysis-section">
        <SelectionListPanel selections={annotations.selections} />
        <GeometricShapesPanel shapes={annotations.shapes} />
      </div>
    ),
  }

  const openForReveal = useEffectEvent((request: LayerReveal) => {
    if (sheet === undefined) onCollapsedChange(false)
    else sheet.onExpandedChange(true)

    if (!expanded.has(request.section)) {
      onExpandedChange(
        panel.sections
          .map((section) => section.id)
          .filter((id) => id === request.section || expanded.has(id)),
      )
    }
  })

  useEffect(() => {
    if (reveal === null) return

    pendingRevealRef.current = reveal
    openForReveal(reveal)
  }, [reveal])

  // Once the panel and section are open, the target scrolls into view and
  // takes focus.
  useEffect(() => {
    const request = pendingRevealRef.current
    const root = panelRef.current
    if (request === null || root === null) return

    const section = root.querySelector<HTMLElement>(
      `[data-layer-section="${request.section}"]`,
    )
    const target =
      request.anchor === null
        ? section
        : (section?.querySelector<HTMLElement>(
            `[data-layer-anchor="${request.anchor}"]`,
          ) ?? null)
    if (target === null || target.closest('[hidden]') !== null) return

    pendingRevealRef.current = null
    target.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
    ;(request.anchor === null
      ? target.querySelector<HTMLElement>('h3 button')
      : target
    )?.focus({ preventScroll: true })
  })

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
      ref={panelRef}
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
      data-layer-section={header.id}
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

// An anchor lets the panel scroll to the heading and focus it (LayerReveal).
function SubHeading({
  children,
  anchor,
}: {
  readonly children: string
  readonly anchor?: LayerAnchor
}) {
  return anchor === undefined ? (
    <h4 className="shell-subheading">{children}</h4>
  ) : (
    <h4 className="shell-subheading" data-layer-anchor={anchor} tabIndex={-1}>
      {children}
    </h4>
  )
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
        <ImageVolumeViewControl image={image} />
      </div>
      <VisiumTissueImageSelect visium={viewOptions.visium} />
      <MerscopeImageSelect merscope={viewOptions.merscope} />
      <AteraImageSelect atera={viewOptions.atera} />
      <ImageChannelControls image={image} />
      <CustomImageLayers layers={image.customLayers} />
    </>
  )
}

function CellsSection({
  cells,
  annotations,
  viewOptions,
}: {
  readonly cells: CellsSectionModel
  readonly annotations: AnnotationsSectionModel
  readonly viewOptions: DatasetViewOptionsModel
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

        <SubHeading anchor="clusters">Clusters</SubHeading>
        <AnnotationSetControls sets={annotations.sets} />
        <AnnotationLabelLists sets={annotations.sets} />
        <MetadataTracksPanel metadataTracks={annotations.metadataTracks} />

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
