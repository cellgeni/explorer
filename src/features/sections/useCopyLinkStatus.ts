import { useEffect, useState } from 'react'
import type { ShareLinkModel } from './datasetInfoModel'

const COPY_STATUS_MS = 2500

export type CopyLinkStatus = 'idle' | 'copied' | 'failed'

interface CopyLinkState {
  readonly status: CopyLinkStatus
  // Each copy is a new state, so a second copy restarts the timer.
  readonly copies: number
}

// Copies the address, which holds the view (15.1-L), and says so for a
// moment. Used by the top bar's Share.
export function useCopyLinkStatus(share: ShareLinkModel) {
  const [state, setState] = useState<CopyLinkState>({ status: 'idle', copies: 0 })
  const { status, copies } = state

  useEffect(() => {
    if (state.status === 'idle') return
    const timeout = window.setTimeout(() => {
      setState((current) => ({ ...current, status: 'idle' }))
    }, COPY_STATUS_MS)
    return () => {
      window.clearTimeout(timeout)
    }
  }, [state])

  return {
    status,
    // Changes with each copy: a key that makes the status region announce a
    // second copy whose message is the same.
    copies,
    message:
      status === 'copied'
        ? 'Link copied'
        : status === 'failed'
          ? 'Could not copy; copy the address bar instead'
          : '',
    copy: () => {
      void share.onCopyLink().then((copied) => {
        setState((current) => ({
          status: copied ? 'copied' : 'failed',
          copies: current.copies + 1,
        }))
      })
    },
  }
}
