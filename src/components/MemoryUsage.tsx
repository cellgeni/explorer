import { useEffect, useState } from 'react'
import {
  memoryTotals,
  readMemoryReports,
  type MemoryReport,
} from '../data/memoryTelemetry'
import { readRuntimeMemorySnapshot } from '../data/runtimeMemory'
import { formatBytes } from '../features/store-structure/storeStructureModel'

// Read again this often while shown.
const MEMORY_REFRESH_MS = 5_000

function readPageHeapSize(): number | undefined {
  return readRuntimeMemorySnapshot()?.usedJSHeapSize
}

// What the caches and workers hold (O20), read while `active` and every few
// seconds after, so it costs nothing while Data access notes is closed.
export function MemoryUsage({
  active,
  read = readMemoryReports,
  readPageHeap = readPageHeapSize,
}: {
  readonly active: boolean
  readonly read?: () => Promise<readonly MemoryReport[]>
  readonly readPageHeap?: () => number | undefined
}) {
  const [reading, setReading] = useState<{
    readonly reports: readonly MemoryReport[]
    readonly pageHeap: number | undefined
  } | null>(null)

  useEffect(() => {
    if (!active) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = async () => {
      const reports = await read()

      if (cancelled) return

      setReading({ reports, pageHeap: readPageHeap() })
      timer = setTimeout(() => void refresh(), MEMORY_REFRESH_MS)
    }

    void refresh()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [active, read, readPageHeap])

  if (reading === null) {
    return (
      <section className="memory-usage" aria-label="Memory">
        <h4>Memory</h4>
        <p>Reading…</p>
      </section>
    )
  }

  // Only what holds something; a pool not started yet has no row.
  const rows = reading.reports.filter(
    (report) => report.entries > 0 || report.workers > 0 || (report.bytes ?? 0) > 0,
  )
  const totals = memoryTotals(rows)

  return (
    <section className="memory-usage" aria-label="Memory">
      <h4>Memory</h4>
      <p>
        {`Caches and workers hold ${formatBytes(totals.bytes)} where measured, with ${totals.workers.toLocaleString()} ${totals.workers === 1 ? 'worker' : 'workers'}.`}
        {reading.pageHeap === undefined
          ? null
          : ` The page's JavaScript heap is ${formatBytes(reading.pageHeap)}.`}
      </p>
      {rows.length === 0 ? null : (
        <table>
          <thead>
            <tr>
              <th scope="col">Held by</th>
              <th scope="col">Memory</th>
              <th scope="col">Items</th>
              <th scope="col">Workers</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((report) => (
              <tr key={report.name}>
                <th scope="row">{report.name}</th>
                <td>{report.bytes === null ? '—' : formatBytes(report.bytes)}</td>
                <td>{report.entries.toLocaleString()}</td>
                <td>{report.workers.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="memory-usage-note">
        — where not measured. A worker's memory counts where it reports it: an H5 file's
        WebAssembly memory and kept blocks, DuckDB's buffers.
      </p>
    </section>
  )
}
