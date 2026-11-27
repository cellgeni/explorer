import { lazy } from 'react'
import { LazyPanel } from '../../components/LazyPanel'
import { CameraIcon, Popover } from '../../components/ui'
import type { ScreenshotModel } from './screenshotModel'

const TITLE = 'Save the spatial view as a high-resolution PNG'

// The popover's form loads the first time it opens, not with the app (O21).
const ScreenshotPanel = lazy(async () => {
  const module = await import('./ScreenshotPanel')
  return { default: module.ScreenshotPanel }
})

// Screenshot in the top bar (plan 27-D1), beside Share: a popover with the
// scale, what to include and the background, and Save PNG. A screenshot keeps
// running when the popover closes; the loading list shows it too.
export function ScreenshotButton({
  screenshot,
  iconOnly,
}: {
  readonly screenshot: ScreenshotModel
  readonly iconOnly: boolean
}) {
  return (
    <Popover
      title={TITLE}
      triggerLabel="Screenshot"
      align="end"
      disabled={!screenshot.available}
      trigger={
        <>
          <CameraIcon />
          {iconOnly ? null : <span className="shell-screenshot-label">Screenshot</span>}
        </>
      }
      triggerClassName={iconOnly ? 'ui-icon-button' : 'shell-screenshot-trigger'}
      className="shell-screenshot"
    >
      <LazyPanel label="Screenshot">
        <ScreenshotPanel screenshot={screenshot} />
      </LazyPanel>
    </Popover>
  )
}
