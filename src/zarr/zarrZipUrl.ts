// Zipped Zarr URL helpers, kept apart from the reader so detection can use
// them without loading the zip reader.

// A zipped store is recognised by suffix, as in SpatialData's `.zarr.zip`
// exports; what the zip holds is checked when it is opened.
export function isZarrZipUrl(url: string): boolean {
  try {
    return /\.zip$/i.test(new URL(url).pathname)
  } catch {
    return false
  }
}
