import { useState, type ReactNode } from 'react'
import {
  BoxSelectIcon,
  Button,
  ChevronDownIcon,
  HelpIcon,
  IconButton,
  InfoIcon,
  Kbd,
  LassoIcon,
  LensIcon,
  LinkIcon,
  PanIcon,
  Popover,
  RulerIcon,
  SettingsIcon,
  Slider,
  Switch,
  Tooltip,
} from '../../components/ui'
import { withMicrometers } from '../../data/units'
import type { ActiveTool } from '../app-shell/activeToolModel'
import { BoundaryLimitField, OpenDatasetForm } from '../sections/DatasetInfoBlocks'
import type { DatasetInfoModel, OpenDatasetModel } from '../sections/datasetInfoModel'
import { useCopyLinkStatus } from '../sections/useCopyLinkStatus'
import {
  CoordinateUnitControl,
  HoverTooltipsToggle,
  MeasureToolOptions,
} from '../sections/ViewSettingsBlocks'
import type { ViewSettingsModel } from '../sections/viewSettingsModel'
import { SHORTCUTS } from './shortcuts'
import type {
  DatasetSummary,
  MagicLensToolModel,
  ToolGroupModel,
  TopBarModel,
} from './topBarModel'

const TOOL_ICONS: Readonly<Record<ActiveTool, ReactNode>> = {
  pan: <PanIcon />,
  box: <BoxSelectIcon />,
  lasso: <LassoIcon />,
  measure: <RulerIcon />,
  'magic-lens': <LensIcon />,
}

interface TopBarProps {
  readonly model: TopBarModel
  readonly info: DatasetInfoModel
  readonly settings: ViewSettingsModel
  readonly infoOpen: boolean
  readonly onInfoOpenChange: (open: boolean) => void
}

// The new shell's top bar (UNIFIED_PLAN.md, 15.2-B): the dataset, its
// summary and ⓘ on the left, the tools in the middle, and Share, Help and
// Settings on the right.
export function TopBar({
  model,
  info,
  settings,
  infoOpen,
  onInfoOpenChange,
}: TopBarProps) {
  return (
    <header className="shell-top-bar">
      <div className="shell-top-bar-start">
        <span className="shell-brand">Explorer</span>
        <DatasetMenu name={model.datasetName} open={info.open} />
        <SummaryChip summary={model.summary} />
        <IconButton
          title="Dataset info"
          icon={<InfoIcon />}
          aria-expanded={infoOpen}
          onClick={() => {
            onInfoOpenChange(!infoOpen)
          }}
        />
      </div>
      <div className="shell-top-bar-tools">
        <ToolGroup tools={model.tools} />
        {model.tools.active === 'measure' ? (
          <Popover
            title="Measure options"
            align="start"
            trigger={<ChevronDownIcon />}
            triggerClassName="ui-icon-button"
          >
            <MeasureToolOptions measure={settings.measure} />
          </Popover>
        ) : null}
        {model.magicLens === null ? null : (
          <Popover
            title="Magic Lens options"
            align="start"
            trigger={<ChevronDownIcon />}
            triggerClassName="ui-icon-button"
            className="shell-lens-options"
          >
            <MagicLensOptions lens={model.magicLens} />
          </Popover>
        )}
      </div>
      <div className="shell-top-bar-end">
        <ShareButton info={info} />
        <Popover
          title="Help"
          align="end"
          trigger={<HelpIcon />}
          triggerClassName="ui-icon-button"
        >
          <ShortcutList />
        </Popover>
        <Popover
          title="Settings"
          align="end"
          trigger={<SettingsIcon />}
          triggerClassName="ui-icon-button"
          className="shell-settings"
        >
          <HoverTooltipsToggle settings={settings} />
          <CoordinateUnitControl settings={settings} />
          <BoundaryLimitField open={info.open} />
          <Switch
            title="Show the deck.gl layer stack, budget and zoom level"
            label="Show debug info"
            checked={model.debugMode}
            onChange={model.onDebugModeChange}
          />
        </Popover>
      </div>
    </header>
  )
}

// The dataset name opens a menu to open another dataset. Examples and recent
// datasets join it with the start screen (15.3-A).
function DatasetMenu({
  name,
  open,
}: {
  readonly name: string | null
  readonly open: OpenDatasetModel
}) {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <Popover
      title="Open dataset"
      open={menuOpen}
      onOpenChange={setMenuOpen}
      triggerClassName="shell-dataset-name"
      className="shell-dataset-menu"
      trigger={
        <>
          <span>{name ?? 'Open a dataset'}</span>
          <ChevronDownIcon />
        </>
      }
    >
      <OpenDatasetForm
        open={{
          ...open,
          onSubmit: (event) => {
            open.onSubmit(event)
            setMenuOpen(false)
          },
        }}
      />
    </Popover>
  )
}

function SummaryChip({ summary }: { readonly summary: DatasetSummary }) {
  return (
    <span className="shell-summary" role="status">
      {summary.status === 'ready'
        ? summary.text
        : summary.status === 'loading'
          ? `Opening ${summary.name}…`
          : ''}
    </span>
  )
}

// One tool at a time (D8). A tool that cannot be used stays focusable, so its
// tooltip can say why.
export function ToolGroup({ tools }: { readonly tools: ToolGroupModel }) {
  return (
    <div className="shell-tools" role="toolbar" aria-label="Tools">
      {tools.options.map((option) => (
        <Tooltip
          key={option.tool}
          placement="bottom"
          title={
            option.reason === undefined
              ? option.label
              : `${option.label}: ${option.reason}`
          }
          detail={<Kbd title={`${option.label} shortcut`}>{option.shortcut}</Kbd>}
        >
          <button
            type="button"
            className="shell-tool"
            aria-label={option.label}
            aria-pressed={tools.active === option.tool}
            aria-disabled={option.disabled}
            aria-keyshortcuts={option.shortcut}
            onClick={() => {
              tools.onSelect(option.tool)
            }}
          >
            {TOOL_ICONS[option.tool]}
          </button>
        </Tooltip>
      ))}
    </div>
  )
}

// The cursor lens's radius, and Summarise View, whose result opens in the
// Magic Lens card (D14).
function MagicLensOptions({ lens }: { readonly lens: MagicLensToolModel }) {
  return (
    <>
      <Slider
        title="Magic lens radius"
        label="Radius"
        min={10}
        max={500}
        step={10}
        value={lens.radiusMicrometers}
        formatValue={(value) => withMicrometers(value.toLocaleString())}
        onChange={lens.onRadiusChange}
      />
      <Button
        title="Summarise the whole view with Magic Lens"
        disabled={!lens.canSummariseView}
        onClick={lens.onSummariseView}
      >
        Summarise View
      </Button>
    </>
  )
}

function ShareButton({ info }: { readonly info: DatasetInfoModel }) {
  const { copy, message } = useCopyLinkStatus(info.share)

  return (
    <span className="shell-share">
      <Button
        title="Copy a link that opens this dataset with the current view"
        variant="ghost"
        disabled={!info.share.canCopyLink}
        onClick={copy}
      >
        <LinkIcon />
        Share
      </Button>
      <span role="status" className="shell-share-status">
        {message}
      </span>
    </span>
  )
}

function ShortcutList() {
  const groups = ['Tools', 'View'] as const

  return (
    <div className="shell-shortcuts">
      {groups.map((group) => (
        <section key={group} aria-label={`${group} shortcuts`}>
          <h3>{group}</h3>
          <dl>
            {SHORTCUTS.filter((shortcut) => shortcut.group === group).map((shortcut) => (
              <div key={shortcut.action}>
                <dt>
                  {shortcut.keys.map((key) => (
                    <Kbd key={key} title={shortcut.action}>
                      {key}
                    </Kbd>
                  ))}
                </dt>
                <dd>{shortcut.action}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  )
}
