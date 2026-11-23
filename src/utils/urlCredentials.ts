// Query parameters that sign or authorise a request: S3 and Google Cloud
// presigned URLs, CloudFront and Azure SAS signatures, and bearer tokens.
const CREDENTIAL_PARAMETER =
  /^(?:x-amz-|x-goog-)|^(?:signature|sig|token|access_token|awsaccessid|awsaccesskeyid|googleaccessid|key-pair-id)$/i

// Resolves an address on this site (`/data/run.h5ad`, `./run.h5ad`), which
// the app accepts, so its query can be read.
const RELATIVE_BASE = 'https://relative.invalid/'

// The address without its query string when the query carries a credential,
// since a presigned URL's other parameters are part of its signature (EXP-026).
// An address on this site stays relative.
export function urlWithoutCredentials(address: string): {
  readonly url: string
  readonly signed: boolean
} {
  let url: URL
  let relative = false

  try {
    url = new URL(address)
  } catch {
    try {
      url = new URL(address, RELATIVE_BASE)
      relative = true
    } catch {
      return { url: address, signed: false }
    }
  }

  if (![...url.searchParams.keys()].some((key) => CREDENTIAL_PARAMETER.test(key))) {
    return { url: address, signed: false }
  }

  if (relative) {
    return { url: address.replace(/\?[^#]*/, ''), signed: true }
  }

  url.search = ''
  return { url: url.toString(), signed: true }
}
