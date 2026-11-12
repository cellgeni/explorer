import {
  useEffect,
  useEffectEvent,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
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
import { isTextEntryTarget, type ActiveTool } from '../app-shell/activeToolModel'
import { BoundaryLimitField, OpenDatasetForm } from '../sections/DatasetInfoBlocks'
import type { DatasetInfoModel, OpenDatasetModel } from '../sections/datasetInfoModel'
import { useCopyLinkStatus } from '../sections/useCopyLinkStatus'
import {
  CoordinateUnitControl,
  AxesToggle,
  HoverTooltipsToggle,
  MinimapToggle,
  MeasureToolOptions,
} from '../sections/ViewSettingsBlocks'
import type { ViewSettingsModel } from '../sections/viewSettingsModel'
import type { DatasetLibraryModel } from '../start/datasetLibraryModel'
import { ExampleGallery, RecentDatasetList } from '../start/StartScreen'
import { HELP_LINKS } from './docLinks'
import { isHelpKey, SHORTCUTS } from './shortcuts'
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
  readonly library: DatasetLibraryModel
  readonly settings: ViewSettingsModel
  readonly infoOpen: boolean
  readonly onInfoOpenChange: (open: boolean) => void
  // Under 860 px the tools fold into a menu and Share drops its label
  // (15.2-I).
  readonly narrow?: boolean | undefined
}

// The top bar (UNIFIED_PLAN.md, 15.2-B): the dataset, its
// summary and ⓘ on the left, the tools in the middle, and Share, Help and
// Settings on the right.
export function TopBar({
  model,
  info,
  library,
  settings,
  infoOpen,
  onInfoOpenChange,
  narrow = false,
}: TopBarProps) {
  return (
    <header className="shell-top-bar">
      <div className="shell-top-bar-start">
        {/* The page's one h1 (15.5-D); under 860 px it is read, not shown. */}
        <h1 className="shell-brand">Explorer</h1>
        <DatasetMenu name={model.datasetName} open={info.open} library={library} />
        <SummaryChip summary={model.summary} />
        <InfoButton
          issueCount={info.diagnostics.errors.length}
          open={infoOpen}
          onOpenChange={onInfoOpenChange}
        />
      </div>
      <div className="shell-top-bar-tools">
        {narrow ? <ToolMenu tools={model.tools} /> : <ToolGroup tools={model.tools} />}
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
        {model.magicLens === null ||
        (narrow && model.tools.active !== 'magic-lens') ? null : (
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
        <ShareButton info={info} iconOnly={narrow} />
        <HelpMenu />
        <Popover
          title="Settings"
          align="end"
          trigger={<SettingsIcon />}
          triggerClassName="ui-icon-button"
          className="shell-settings"
        >
          <HoverTooltipsToggle settings={settings} />
          <MinimapToggle settings={settings} />
          <AxesToggle settings={settings} />
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

// ⓘ, with a badge counting load issues, which the drawer's Diagnostics lists
// (15.2-F).
function InfoButton({
  issueCount,
  open,
  onOpenChange,
}: {
  readonly issueCount: number
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}) {
  const label =
    issueCount === 0
      ? 'Dataset info'
      : `Dataset info (${issueCount.toLocaleString()} ${issueCount === 1 ? 'issue' : 'issues'})`

  return (
    <span className="shell-info-button">
      <IconButton
        title={label}
        icon={<InfoIcon />}
        aria-expanded={open}
        onClick={() => {
          onOpenChange(!open)
        }}
      />
      {issueCount === 0 ? null : (
        <span className="shell-issue-badge" aria-hidden="true">
          {issueCount > 9 ? '9+' : issueCount}
        </span>
      )}
    </span>
  )
}

// The dataset name opens a menu to open another dataset, with recent
// datasets and the examples (15.3-A).
function DatasetMenu({
  name,
  open,
  library,
}: {
  readonly name: string | null
  readonly open: OpenDatasetModel
  readonly library: DatasetLibraryModel
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const openFromMenu = (url: string) => {
    library.onOpen(url)
    setMenuOpen(false)
  }

  return (
    <Popover
      title="Open dataset"
      open={menuOpen}
      onOpenChange={(nextOpen) => {
        setMenuOpen(nextOpen)
        if (nextOpen) library.onLoadExamples()
      }}
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
        boundaryLimit="advanced"
        open={{
          ...open,
          onSubmit: (event) => {
            open.onSubmit(event)
            setMenuOpen(false)
          },
        }}
      />
      {library.recent.length === 0 ? null : (
        // Not named regions: the start screen behind has its own Recent and
        // Examples (15.5-D). Headings start at h2 in a dialog.
        <section className="shell-dataset-menu-section">
          <h2>Recent</h2>
          <RecentDatasetList
            recent={library.recent}
            onOpen={openFromMenu}
            onRemove={library.onRemoveRecent}
          />
        </section>
      )}
      <section className="shell-dataset-menu-section">
        <h2>Examples</h2>
        <ExampleGallery library={{ ...library, onOpen: openFromMenu }} variant="menu" />
      </section>
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
// One tab stop, on the active tool; arrows, Home and End move between the
// tools, as the ARIA toolbar pattern has it (15.5-D).
export function ToolGroup({ tools }: { readonly tools: ToolGroupModel }) {
  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const buttons = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>('button.shell-tool'),
    ]
    const index = buttons.findIndex((button) => button === event.target)
    if (index < 0) return

    const nextIndex =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? (index + 1) % buttons.length
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? (index - 1 + buttons.length) % buttons.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : undefined
    if (nextIndex === undefined) return

    event.preventDefault()
    buttons[nextIndex]?.focus()
  }

  return (
    <div
      className="shell-tools"
      role="toolbar"
      aria-label="Tools"
      onKeyDown={handleKeyDown}
    >
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
            tabIndex={tools.active === option.tool ? 0 : -1}
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

// The tools as a menu, for narrow screens: the trigger shows the active
// tool, and picking one closes the menu.
export function ToolMenu({ tools }: { readonly tools: ToolGroupModel }) {
  const [open, setOpen] = useState(false)
  const active = tools.options.find((option) => option.tool === tools.active)

  return (
    <Popover
      title="Tools"
      align="end"
      open={open}
      onOpenChange={setOpen}
      triggerClassName="shell-tool-menu-trigger"
      className="shell-tool-menu"
      trigger={
        <>
          {TOOL_ICONS[tools.active]}
          <span className="visually-hidden">Tools: {active?.label ?? 'Pan'}</span>
          <ChevronDownIcon />
        </>
      }
    >
      <div role="group" aria-label="Tools" className="shell-tool-menu-list">
        {tools.options.map((option) => (
          <button
            key={option.tool}
            type="button"
            className="shell-tool-menu-item"
            title={
              option.reason === undefined
                ? option.label
                : `${option.label}: ${option.reason}`
            }
            aria-pressed={tools.active === option.tool}
            aria-disabled={option.disabled}
            aria-keyshortcuts={option.shortcut}
            onClick={() => {
              tools.onSelect(option.tool)
              if (!option.disabled) setOpen(false)
            }}
          >
            {TOOL_ICONS[option.tool]}
            <span>{option.label}</span>
            {option.reason === undefined ? null : (
              <small className="shell-tool-menu-reason">{option.reason}</small>
            )}
            <Kbd title={`${option.label} shortcut`}>{option.shortcut}</Kbd>
          </button>
        ))}
      </div>
    </Popover>
  )
}

function ShareButton({
  info,
  iconOnly,
}: {
  readonly info: DatasetInfoModel
  readonly iconOnly: boolean
}) {
  const { copy, message } = useCopyLinkStatus(info.share)
  const title = 'Copy a link that opens this dataset with the current view'

  return (
    <span className="shell-share">
      {iconOnly ? (
        <IconButton
          title={title}
          aria-label="Share"
          icon={<LinkIcon />}
          disabled={!info.share.canCopyLink}
          onClick={copy}
        />
      ) : (
        <Button
          title={title}
          variant="ghost"
          disabled={!info.share.canCopyLink}
          onClick={copy}
        >
          <LinkIcon />
          Share
        </Button>
      )}
      <span role="status" className="shell-share-status">
        {message}
      </span>
    </span>
  )
}

// Help (15.3-B): the shortcuts and links to the guides. ? opens and closes
// it, except while typing.
function HelpMenu() {
  const [open, setOpen] = useState(false)
  const toggle = useEffectEvent(() => {
    setOpen((current) => !current)
  })

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat || isTextEntryTarget(event.target)) {
        return
      }
      if (!isHelpKey(event)) return

      event.preventDefault()
      toggle()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  return (
    <Popover
      title="Help"
      align="end"
      open={open}
      onOpenChange={setOpen}
      trigger={<HelpIcon />}
      triggerClassName="ui-icon-button"
      className="shell-help"
    >
      <ShortcutList />
      <nav className="shell-help-links" aria-label="Guides">
        <h2>Guides</h2>
        <ul>
          {HELP_LINKS.map((link) => (
            <li key={link.href}>
              <a href={link.href} target="_blank" rel="noopener noreferrer">
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </Popover>
  )
}

function ShortcutList() {
  const groups = ['Tools', 'View'] as const

  return (
    <div className="shell-shortcuts">
      {groups.map((group) => (
        <section key={group} aria-label={`${group} shortcuts`}>
          <h2>{group}</h2>
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
