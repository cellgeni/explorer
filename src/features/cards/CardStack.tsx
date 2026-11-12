import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { Button, Card } from '../../components/ui'
import { focusFirst } from '../../components/ui/useDismiss'
import { BoundaryCellInfoPanel } from '../cells/BoundaryCellInfoPanel'
import { CellInfoPanel } from '../cells/CellInfoPanel'
import { GridCellInfoPanel } from '../cells/GridCellInfoPanel'
import { MagicLensPanel, RoiGeneStatsPanel } from '../roi/RoiPanels'
import { TranscriptInspectionPanel } from '../transcripts/TranscriptStatusPanel'
import type {
  CardStackModel,
  CellCardModel,
  MagicLensCardModel,
  RegionSelectionCardModel,
  SelectionCardModel,
  SelectionLensModel,
  TranscriptCardModel,
} from './cardModels'

// The cards (UNIFIED_PLAN.md, 15.2-D), top left over the canvas: Selection,
// Cell (Spot, Bin), Transcript and Magic Lens.
export function CardStack({ cards }: { readonly cards: CardStackModel }) {
  const { selection, cell, transcript, magicLens } = cards

  if (selection === null && cell === null && transcript === null && magicLens === null) {
    return null
  }

  return (
    <div className="shell-card-stack">
      {selection === null ? null : (
        <CardSlot key={`selection:${selection.variant}`}>
          <SelectionCard card={selection} />
        </CardSlot>
      )}
      {cell === null ? null : (
        <CardSlot key={cellKey(cell)}>
          <CellCard card={cell} />
        </CardSlot>
      )}
      {transcript === null ? null : (
        <CardSlot key="transcript">
          <TranscriptCard card={transcript} />
        </CardSlot>
      )}
      {magicLens === null ? null : (
        <CardSlot key="magic-lens">
          <MagicLensCard card={magicLens} />
        </CardSlot>
      )}
    </div>
  )
}

// A card that appears, or a new cell, scrolls into view if the stack has
// grown past the canvas. A card that closes while it holds focus hands focus
// to the card now in its place, or else to the canvas (15.5-D).
function CardSlot({ children }: { readonly children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: 'nearest' })
  }, [])

  // A layout cleanup runs while the card is still in the page.
  useLayoutEffect(() => {
    const slot = ref.current
    return () => {
      const stack = slot?.parentElement
      if (slot === null || stack === null || stack === undefined) return
      if (!slot.contains(document.activeElement)) return

      const index = [...stack.children].indexOf(slot)
      queueMicrotask(() => {
        const active = document.activeElement
        if (active !== null && active !== document.body) return

        const slots = stack.isConnected
          ? stack.querySelectorAll<HTMLElement>(':scope > .shell-card-slot')
          : []
        const next = slots[Math.min(index, slots.length - 1)]
        if (next !== undefined) {
          focusFirst(next)
          return
        }
        document.querySelector<HTMLElement>('.viewport-frame')?.focus()
      })
    }
  }, [])

  return (
    <div ref={ref} className="shell-card-slot">
      {children}
    </div>
  )
}

function cellKey(card: CellCardModel): string {
  return `${card.kind}:${card.cell.id}`
}

function SelectionName({ card }: { readonly card: SelectionCardModel }) {
  const id = useId()

  return (
    <div className="shell-card-name">
      <label htmlFor={id}>{card.nameLabel}</label>
      <input
        id={id}
        type="text"
        autoComplete="off"
        spellCheck={false}
        value={card.name}
        disabled={card.nameDisabled}
        title={card.nameLabel}
        onChange={(event) => {
          card.onNameChange(event.currentTarget.value)
        }}
      />
    </div>
  )
}

export function SelectionCard({ card }: { readonly card: SelectionCardModel }) {
  if (card.variant === 'geometry') {
    return (
      <Card
        title="New shape"
        subtitle={card.status}
        closeTitle={card.closeTitle}
        onClose={card.onClose}
        className="shell-card"
      >
        <SelectionName card={card} />
        <p className="shell-card-hint">
          Drag on the canvas to draw. The shape joins Annotations.
        </p>
      </Card>
    )
  }

  return <RegionSelectionCard card={card} />
}

type SelectionTab = 'genes' | 'elements' | 'lens'

function RegionSelectionCard({ card }: { readonly card: RegionSelectionCardModel }) {
  const [tab, setTab] = useState<SelectionTab>('genes')
  const tabs: readonly { readonly id: SelectionTab; readonly label: string }[] = [
    { id: 'genes', label: 'Genes' },
    { id: 'elements', label: card.elementsLabel },
    ...(card.lens === null ? [] : [{ id: 'lens' as const, label: card.lens.label }]),
  ]
  const activeTab = tabs.some((candidate) => candidate.id === tab) ? tab : 'genes'

  return (
    <Card
      title={card.name.trim() === '' ? 'Selection' : card.name}
      subtitle={
        <span className={card.loading ? 'shell-card-status is-loading' : undefined}>
          {card.loading || card.summary === null ? card.status : card.summary}
        </span>
      }
      actions={<GoToButton title="Go to the selection" onGoTo={card.onGoTo} />}
      closeTitle={card.closeTitle}
      onClose={card.onClose}
      className="shell-card"
    >
      <div className="shell-card-name-row">
        <SelectionName card={card} />
        {card.onSave === null ? null : (
          <Button
            title="Save ROI as annotation"
            disabled={!card.ready}
            onClick={card.onSave}
          >
            Save ROI
          </Button>
        )}
      </div>
      <Tabs label="Selection details" tabs={tabs} active={activeTab} onChange={setTab}>
        {activeTab === 'genes' ? (
          <>
            <RoiGeneStatsPanel
              copy={card.genes.copy}
              elementPlural={card.genes.elementPlural}
              elementSingular={card.genes.elementSingular}
              state={card.genes.state}
              title={card.genes.title}
              reference={card.genes.reference}
              selectedGenes={card.genes.selectedGenes}
              onShowGene={card.genes.onShowGene}
            />
            {card.genes.state.status === 'idle' ? (
              <p className="roi-gene-status" aria-live="polite">
                {card.genes.emptyMessage ?? card.status}
              </p>
            ) : null}
          </>
        ) : activeTab === 'elements' ? (
          card.stats.length === 0 ? (
            <p className="roi-gene-status">{card.status}</p>
          ) : (
            <dl className="roi-summary-list" aria-label="ROI summary">
              {card.stats.map((stat) => (
                <div key={stat.label}>
                  <dt>{stat.label}</dt>
                  <dd>{stat.value}</dd>
                </div>
              ))}
            </dl>
          )
        ) : card.lens === null ? null : (
          <SelectionLens lens={card.lens} />
        )}
      </Tabs>
      <div className="shell-card-actions">
        {card.exports.map((action) => (
          <Button
            key={action.label}
            title={action.title}
            variant="ghost"
            disabled={!card.ready || action.busy}
            onClick={action.onExport}
          >
            {action.busy ? (action.busyLabel ?? action.label) : action.label}
          </Button>
        ))}
        <Button title="Delete selection" variant="danger" onClick={card.onDelete}>
          Delete
        </Button>
      </div>
    </Card>
  )
}

function SelectionLens({ lens }: { readonly lens: SelectionLensModel }) {
  return (
    <div className="shell-card-lens">
      <Button
        title={`Summarise ${lens.label.toLowerCase()} in the selection with Magic Lens`}
        disabled={!lens.canRun}
        onClick={lens.onRun}
      >
        {lens.state.status === 'loading' ? 'Scanning…' : `Summarise ${lens.label}`}
      </Button>
      <MagicLensPanel state={lens.state} />
    </div>
  )
}

// Tabs with arrow-key movement between them; only the active panel renders.
function Tabs<T extends string>({
  label,
  tabs,
  active,
  onChange,
  children,
}: {
  readonly label: string
  readonly tabs: readonly { readonly id: T; readonly label: string }[]
  readonly active: T
  readonly onChange: (tab: T) => void
  readonly children: ReactNode
}) {
  const baseId = useId()
  const tabRefs = useRef(new Map<T, HTMLButtonElement>())

  // Arrows move to the next or previous tab, Home and End to the first or
  // last, as the ARIA tabs pattern has it.
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = tabs.findIndex((tab) => tab.id === active)
    const nextIndex =
      event.key === 'ArrowRight'
        ? index + 1
        : event.key === 'ArrowLeft'
          ? index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : undefined
    if (nextIndex === undefined) return

    const next = tabs[(nextIndex + tabs.length) % tabs.length]
    if (next === undefined) return

    event.preventDefault()
    onChange(next.id)
    tabRefs.current.get(next.id)?.focus()
  }

  return (
    <div className="shell-card-tabs">
      <div role="tablist" aria-label={label} onKeyDown={handleKeyDown}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            ref={(element) => {
              if (element === null) tabRefs.current.delete(tab.id)
              else tabRefs.current.set(tab.id, element)
            }}
            id={`${baseId}-${tab.id}-tab`}
            type="button"
            role="tab"
            title={`Show ${tab.label.toLowerCase()}`}
            aria-selected={tab.id === active}
            aria-controls={`${baseId}-panel`}
            tabIndex={tab.id === active ? 0 : -1}
            onClick={() => {
              onChange(tab.id)
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div
        id={`${baseId}-panel`}
        role="tabpanel"
        aria-labelledby={`${baseId}-${active}-tab`}
        className="shell-card-tab-panel"
      >
        {children}
      </div>
    </div>
  )
}

// Shows what the card is about (zoomToBbox, 15.2-E).
function GoToButton({
  title,
  onGoTo,
}: {
  readonly title: string
  readonly onGoTo: () => void
}) {
  return (
    <Button title={title} variant="ghost" className="shell-card-go-to" onClick={onGoTo}>
      Go To
    </Button>
  )
}

export function CellCard({ card }: { readonly card: CellCardModel }) {
  return (
    <Card
      title={card.title}
      subtitle={
        <span className={card.loading ? 'shell-card-status is-loading' : undefined}>
          {card.status}
        </span>
      }
      actions={
        <GoToButton
          title={`Go to the selected ${card.title.toLowerCase()}`}
          onGoTo={card.onGoTo}
        />
      }
      closeTitle={`Clear selected ${card.title.toLowerCase()}`}
      onClose={card.onClose}
      className="shell-card"
    >
      {card.kind === 'boundary' ? (
        <BoundaryCellInfoPanel
          cell={card.cell}
          expressionStatus={card.expressionStatus}
          expressionProfileState={card.profileState}
          onLoadExpressionProfile={card.onLoadProfile}
        />
      ) : card.kind === 'bin' ? (
        <GridCellInfoPanel
          cell={card.cell}
          assignmentState={card.assignmentState}
          expressionStatus={card.expressionStatus}
          expressionProfileState={card.profileState}
          onLoadExpressionProfile={card.onLoadProfile}
        />
      ) : (
        <CellInfoPanel
          cell={card.cell}
          annotationLabels={card.annotationLabels}
          state={card.state}
          transcriptDistributionState={card.distributionState}
          transcriptDistributionVisible={card.distributionVisible}
          variant={card.variant}
        />
      )}
    </Card>
  )
}

export function TranscriptCard({ card }: { readonly card: TranscriptCardModel }) {
  return (
    <Card
      title={card.title}
      actions={
        <GoToButton
          title={`Go to the pinned ${card.title.toLowerCase()}`}
          onGoTo={card.onGoTo}
        />
      }
      closeTitle="Clear pinned transcript"
      onClose={card.onClose}
      className="shell-card"
    >
      <TranscriptInspectionPanel detail={card.detail} showFov={card.showFov} />
    </Card>
  )
}

export function MagicLensCard({ card }: { readonly card: MagicLensCardModel }) {
  return (
    <Card
      title="Magic Lens"
      subtitle={
        <span className={card.loading ? 'shell-card-status is-loading' : undefined}>
          {card.status}
        </span>
      }
      closeTitle={card.scope === 'cursor' ? 'Turn off Magic Lens' : 'Clear Magic Lens'}
      onClose={card.onClose}
      className="shell-card"
    >
      {card.state.status === 'idle' ? (
        <p className="shell-card-hint">
          Move the cursor over the tissue to summarise what is under the lens.
        </p>
      ) : (
        <MagicLensPanel state={card.state} />
      )}
    </Card>
  )
}
