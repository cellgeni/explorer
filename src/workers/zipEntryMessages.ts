import type { ZipEntry } from '../data/zipArchive'

// A zip entry worker reads one entry of a zip over HTTP and exits: it
// fetches the entry's bytes, inflates them, and sends them back transferred.

export interface ZipEntryWorkerRequest {
  readonly type: 'read'
  readonly url: string
  readonly entry: ZipEntry
}

export type ZipEntryWorkerResponse =
  | { readonly type: 'progress'; readonly received: number; readonly total: number }
  | { readonly type: 'entry'; readonly bytes: ArrayBuffer }
  | { readonly type: 'error'; readonly error: string; readonly errorName?: string }
