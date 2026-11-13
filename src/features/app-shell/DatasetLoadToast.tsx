import { CloseIcon, IconButton } from '../../components/ui'
import type { StructuredLoadError } from '../errors/loadErrorModel'
import { datasetDisplayName } from './documentTitle'

interface DatasetLoadToastProps {
  readonly failedUrl: string
  readonly error: StructuredLoadError
  // The dataset still on screen.
  readonly openDatasetName: string | null
  readonly onDismiss: () => void
}

// Says that a new dataset failed to load and the open one stays
// (plan 15.1-F). The Issues card has the details.
export function DatasetLoadToast({
  failedUrl,
  error,
  openDatasetName,
  onDismiss,
}: DatasetLoadToastProps) {
  const failedName = datasetDisplayName(failedUrl, undefined) ?? failedUrl

  return (
    <div className="dataset-load-toast" role="alert">
      <div className="dataset-load-toast-text">
        <strong>{error.title}</strong>
        <p>
          {failedName} could not be opened
          {openDatasetName === null ? '.' : `; ${openDatasetName} is still open.`}
        </p>
        <p className="dataset-load-toast-action">{error.action}</p>
      </div>
      <IconButton title="Dismiss" icon={<CloseIcon />} onClick={onDismiss} />
    </div>
  )
}
