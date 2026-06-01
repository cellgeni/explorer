export type RangeSupportFetcher = typeof fetch

export interface AssertHttpRangeSupportOptions {
  readonly fetcher?: RangeSupportFetcher
  readonly label?: string
}

const RANGE_PROBE_HEADER = 'bytes=0-0'

export async function assertHttpRangeSupport(
  url: string,
  options: AssertHttpRangeSupportOptions = {},
): Promise<void> {
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
  let response: Response

  try {
    response = await fetcher(url, {
      method: 'GET',
      headers: {
        Range: RANGE_PROBE_HEADER,
      },
    })
  } catch (cause) {
    throw new Error(
      `${readTargetLabel(options.label)} cannot be range-read. The Range probe failed before an HTTP response was available. Confirm CORS allows GET and the Range request header for ${url}.`,
      { cause },
    )
  }

  const contentRange = response.headers.get('Content-Range')

  if (response.status !== 206) {
    throw new Error(
      `${readTargetLabel(options.label)} cannot be range-read. Expected HTTP 206 for Range: ${RANGE_PROBE_HEADER}, received HTTP ${response.status}. Configure the host to honor byte-range GET requests for ${url}.`,
    )
  }

  if (contentRange === null || contentRange.trim().length === 0) {
    throw new Error(
      `${readTargetLabel(options.label)} cannot be range-read. The Range probe returned HTTP 206 but Content-Range was not exposed to the browser. Add Content-Range to Access-Control-Expose-Headers for ${url}.`,
    )
  }
}

function readTargetLabel(label: string | undefined): string {
  return label ?? 'Dataset file'
}
