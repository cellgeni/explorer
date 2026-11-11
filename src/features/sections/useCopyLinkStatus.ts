import { useEffect, useState } from 'react'
import type { ShareLinkModel } from './datasetInfoModel'

const COPY_STATUS_MS = 2500

export type CopyLinkStatus = 'idle' | 'copied' | 'failed'

// Copies the address, which holds the view (15.1-L), and says so for a
// moment. Used by Copy Link and the top bar's Share.
export function useCopyLinkStatus(share: ShareLinkModel) {
  const [status, setStatus] = useState<CopyLinkStatus>('idle')

  useEffect(() => {
    if (status === 'idle') return
    const timeout = window.setTimeout(() => {
      setStatus('idle')
    }, COPY_STATUS_MS)
    return () => {
      window.clearTimeout(timeout)
    }
  }, [status])

  return {
    status,
    message:
      status === 'copied'
        ? 'Link copied'
        : status === 'failed'
          ? 'Could not copy; copy the address bar instead'
          : '',
    copy: () => {
      void share.onCopyLink().then((copied) => {
        setStatus(copied ? 'copied' : 'failed')
      })
    },
  }
}
