// An .h5ad file up to this size is downloaded whole when its host does not
// answer Range requests; a larger one needs Range support or a companion
// reference. Kept apart from h5adDataset.ts so diagnostics can use it without
// importing the reader.
export const H5AD_MAX_FILE_BYTES = 300 * 1024 * 1024
