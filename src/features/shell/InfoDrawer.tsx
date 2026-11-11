import { useId, type ReactNode } from 'react'
import { Drawer } from '../../components/ui'
import {
  DatasetAbout,
  DatasetDiagnostics,
  DatasetViewOptions,
  LayerStackLines,
  OpenDatasetForm,
} from '../sections/DatasetInfoBlocks'
import type { DatasetInfoModel } from '../sections/datasetInfoModel'

interface InfoDrawerProps {
  readonly info: DatasetInfoModel
  readonly open: boolean
  readonly onClose: () => void
}

// ⓘ's dataset info drawer (UNIFIED_PLAN.md, 15.2-F): what is open, the
// manifest's About, the view options that have no layer section, opening
// another dataset, and Diagnostics with the issues, notes and log.
export function InfoDrawer({ info, open, onClose }: InfoDrawerProps) {
  const { visium, spatialData } = info.viewOptions
  const hasViewOptions =
    visium.state.status !== 'idle' || spatialData.state.status !== 'idle'

  return (
    <Drawer
      title="Dataset info"
      open={open}
      onClose={onClose}
      className="shell-info-drawer"
    >
      <DrawerSection title="Dataset">
        {info.facts.length === 0 ? (
          <p className="shell-drawer-empty">No dataset is open.</p>
        ) : (
          <dl className="shell-dataset-facts">
            {info.facts.map((fact) => (
              <div key={fact.label}>
                <dt>{fact.label}</dt>
                <dd title={fact.value}>{fact.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </DrawerSection>
      {info.about === null ? null : (
        <DrawerSection title="About">
          <DatasetAbout about={info.about} />
        </DrawerSection>
      )}
      {hasViewOptions ? (
        <DrawerSection title="View options">
          <DatasetViewOptions viewOptions={info.viewOptions} placement="drawer" />
        </DrawerSection>
      ) : null}
      <DrawerSection title="Open another dataset">
        <OpenDatasetForm open={info.open} boundaryLimit="advanced" />
      </DrawerSection>
      <DrawerSection title="Diagnostics">
        <DatasetDiagnostics diagnostics={info.diagnostics} />
        {info.diagnostics.layerStack === null ? null : (
          <div className="shell-layer-stack">
            <LayerStackLines diagnostics={info.diagnostics} />
          </div>
        )}
      </DrawerSection>
    </Drawer>
  )
}

function DrawerSection({
  title,
  children,
}: {
  readonly title: string
  readonly children: ReactNode
}) {
  const headingId = useId()

  return (
    <section className="shell-drawer-section" aria-labelledby={headingId}>
      <h3 id={headingId}>{title}</h3>
      {children}
    </section>
  )
}
