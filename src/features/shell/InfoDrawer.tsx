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

// ⓘ's dataset info drawer (plan 15.2-F): what is open, the
// manifest's About, the view options that have no layer section, opening
// another dataset, and Diagnostics with the issues, notes and log. Its
// sections render only while it is open, so the open-dataset form is not in
// the page twice (the dataset name menu has one too).
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
      {open ? (
        <>
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
              <DatasetViewOptions viewOptions={info.viewOptions} />
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
        </>
      ) : null}
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
