import { plotFileName } from '../plots/plotExport'
import { buildCommit, buildRelease } from '../shell/docLinks'
import { urlWithoutCredentials } from '../../utils/urlCredentials'
import type { ScreenshotInclude } from './screenshotOverlay'
import type { ScreenshotFileInfo } from './screenshotRun'
import type { ScreenshotRunner } from './screenshotRunner'

// What the top bar's Screenshot popover (plan 27, task H) gets from App: the
// runner, and what only App knows of the view.
export interface ScreenshotModel {
  readonly runner: ScreenshotRunner
  // A dataset is open; the popover says when its view has not drawn yet.
  readonly available: boolean
  // D6: Include starts from Settings' switches, and selections on.
  readonly include: ScreenshotInclude
  // D7: the view's samples and loads, which the popover notes.
  readonly expressionSampled: boolean
  readonly transcriptsAsDensity: boolean
  readonly loadingLabels: readonly string[]
  readonly file: ScreenshotFileInfo
}

export const SCREENSHOT_SOFTWARE_NAME = 'Spatial Omics Explorer'

// The app's name, with its release and commit where the build has them.
export function screenshotSoftware(
  release = buildRelease(),
  commit = buildCommit(),
): string {
  const parts = [SCREENSHOT_SOFTWARE_NAME]
  if (release !== null) parts.push(release.tag)
  if (commit !== null) parts.push(`(${commit.short})`)
  return parts.join(' ')
}

// 27-D11: `{dataset}-screenshot.png`, named as plot exports are, with the
// dataset's address as ROI exports write it.
export function screenshotFileInfo(
  datasetUrl: string,
  zPlane: number | null,
  software = screenshotSoftware(),
): ScreenshotFileInfo {
  const source = urlWithoutCredentials(datasetUrl).url

  return {
    fileName: plotFileName(source, 'screenshot', null, 'png'),
    software,
    source: source.trim() === '' ? null : source,
    zPlane,
  }
}
