// A fetch for Parquet readers whose Range requests skip Chromium's HTTP
// cache, as TIFF tiles and Zarr shards do. The cache lets one Range request
// to a URL through at a time, until its headers arrive, so the column chunks
// a reader asks for together went out one after another (O11 in the
// optimization pass), and two reads of the same bytes at once can get a
// body cut short. Other requests, such as hyparquet's HEAD, keep the cache.
export function rangeReadsWithoutHttpCache(fetcher: typeof fetch): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    )

    return headers.has('Range')
      ? fetcher(input, { ...init, cache: 'no-store' })
      : fetcher(input, init)
  }
}
