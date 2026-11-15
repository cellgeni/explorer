// OME-Zarr image URLs are recognised by path: a store named `.zarr` or
// `.ome.zarr`, its metadata file, or a group inside a `.zarr` store, such as a
// SpatialData store's `images/morphology` or a bioformats2raw series `0`.
// Inside a store, a last part with a dot is a file kept in the store's folder
// (a TIFF, a table), not a group. Kept apart from the loader so the dataset
// manifest parser can use it without importing zarrita.
export function isOmeZarrImageUrl(url: string): boolean {
  const path = new URL(url).pathname.replace(/\/+$/, '')
  return OME_ZARR_STORE_PATH.test(path) || ZARR_STORE_GROUP_PATH.test(path)
}

const OME_ZARR_STORE_PATH = /(?:\.ome\.zarr|\.zarr|\/zarr\.json|\/\.zattrs)$/i
const ZARR_STORE_GROUP_PATH = /\.zarr\/(?:[^/]+\/)*[^/.]+$/i
