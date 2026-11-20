// DOC review: the docs say Visium HD has no Plots toggle (user-guide.md:433,
// ui-reference.md:195-196 and the Platform Availability row). App.tsx shows the
// toggle when `capabilities.cells && capabilities.annotations`
// (App.tsx:4593-4594, ShellLayout.tsx:194-196). The expected value below comes
// from the docs, not from production code.
import { describe, expect, it } from 'vitest'
import { appPlatformAdapterFor } from '../../../../../../src/features/app-shell/platformAdapter'

const DOCUMENTED_PLOTS_ON_VISIUM_HD = false

describe('Plots toggle on Visium HD', () => {
  it('matches the documented availability', () => {
    const adapter = appPlatformAdapterFor(
      { status: 'ready' } as Parameters<typeof appPlatformAdapterFor>[0],
      'visium-hd',
    )
    // The same expression App.tsx uses for plotsAvailable.
    const plotsAvailable = adapter.capabilities.cells && adapter.capabilities.annotations
    expect(plotsAvailable).toBe(DOCUMENTED_PLOTS_ON_VISIUM_HD)
  })
})
