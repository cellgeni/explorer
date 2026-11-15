import type { FeatureBarcodeMexUrls } from '../datasets/featureBarcodeMex'
import type { FeatureBarcodeMatrix } from '../datasets/visiumDataset'

// A feature-barcode MEX worker reads one matrix.mtx with its barcode and
// feature lists and exits: it fetches all three, parses the matrix into CSR
// arrays as it streams in, and sends the matrix back with its arrays
// transferred.

export interface FeatureBarcodeMexWorkerRequest {
  readonly type: 'read'
  readonly urls: FeatureBarcodeMexUrls
}

export type FeatureBarcodeMexWorkerResponse =
  | { readonly type: 'progress'; readonly message: string }
  | { readonly type: 'matrix'; readonly matrix: FeatureBarcodeMatrix }
  | { readonly type: 'error'; readonly error: string; readonly errorName?: string }
