// OME-Zarr image URLs are recognised by suffix. Kept apart from the loader so
// the dataset manifest parser can use it without importing zarrita.
export function isOmeZarrImageUrl(url: string): boolean {
  const path = new URL(url).pathname
  return /(?:\.ome\.zarr|\.zarr|\/zarr\.json|\/\.zattrs)$/i.test(path)
}
