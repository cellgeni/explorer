// Query parameters that sign or authorise a request: S3 and Google Cloud
// presigned URLs, CloudFront and Azure SAS signatures, and bearer tokens.
const CREDENTIAL_PARAMETER =
  /^(?:x-amz-|x-goog-)|^(?:signature|sig|token|access_token|awsaccessid|awsaccesskeyid|googleaccessid|key-pair-id)$/i

// The address without its query string when the query carries a credential,
// since a presigned URL's other parameters are part of its signature (EXP-026).
export function urlWithoutCredentials(address: string): {
  readonly url: string
  readonly signed: boolean
} {
  let url: URL

  try {
    url = new URL(address)
  } catch {
    return { url: address, signed: false }
  }

  if (![...url.searchParams.keys()].some((key) => CREDENTIAL_PARAMETER.test(key))) {
    return { url: address, signed: false }
  }

  url.search = ''
  return { url: url.toString(), signed: true }
}
