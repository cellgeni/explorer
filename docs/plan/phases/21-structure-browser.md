# Phase 21 — Store And File Browser (Recorded From Git)

Shipped from 2026-11-15 to 2026-11-16 (PRs #120, #124, #125). Not planned in
advance. There was no way to see what a Zarr store or Parquet file holds from
the UI: the address field only loads a dataset, and Diagnose Dataset checks
only the arrays the viewer needs.

Current behaviour is documented in [`docs/user-guide.md`](../../user-guide.md)
and [`docs/ui-reference.md`](../../ui-reference.md) (Store Structure Drawer).

## Product Decisions

- **DECISION:** Browse without opening the dataset, so it also works for
  stores and files the viewer cannot load.
- **DECISION:** One non-modal drawer (560 px, over the canvas) shared by the
  Zarr and Parquet views (`StructureBrowser.tsx`, `structureTree.ts`). It
  keeps its tree while closed, and closing it during a read stops the read.

## Delivered

- [x] **Browse Store** (#120, 2026-11-15) beside `Load Dataset` when the
      address is a Zarr store: a `.zarr` or `.ome.zarr` folder or a group
      inside one, `zarr.json`/`.zattrs`/`.zgroup`/`.zmetadata`, a `.zip`, or
      an `.icechunk` repository. `readZarrStructure`
      (`src/zarr/zarrStructure.ts`) takes nodes from consolidated metadata,
      the zip directory, or Icechunk's `main` snapshot; otherwise it walks
      from the root using the host's listing (S3 ListObjectsV2 or index
      pages, `src/zarr/zarrFolderLister.ts`) or the groups' attributes
      (AnnData encodings, OME-NGFF, plates, bioformats2raw, SpatialData),
      stopping at 5,000 nodes. The tree shows role badges, and the details
      show shape, dtype, chunks or shards, codecs, sizes, attributes and the
      metadata document.
- [x] **Browse File** (#124, 2026-11-16) for `.parquet`, `.parq` and `.pq`
      addresses, and from a Parquet file in a zip, a listed folder, or a
      SpatialData shapes group (`Back to Store` returns to the tree).
      `readParquetStructure` (`src/data/parquetStructure.ts`) reads only the
      footer: schema with reader types, column codecs, sizes and statistics,
      GeoParquet geometry, the row-group table and key-value metadata.
- [x] **Rows** (#125, 2026-11-16): the first 20 rows of the first row group
      that holds rows. `readParquetRows` (`src/data/parquetRows.ts`) walks
      flat columns' page headers and fetches only the first pages, in
      parallel with `cache: 'no-store'`; nested columns use the offset index.
      A row group over 8 MB waits for `Read Rows`.

Measured live:

- The hindlimb AnnData store (no consolidated metadata) walks to 33 groups
  and 130 arrays in about 10 s with the bucket's S3 listing.
- The Xenium demo's `cells.parquet` footer: a `HEAD` and one 512 KB range,
  about 0.4 s.
- Rows of the AU14 ovary `shapes.parquet` (pyarrow, 14.1 MB row group):
  1.34 MB in 0.8 s. The Xenium `cells.parquet` (fastparquet, one page per
  column chunk) asks first, then reads its 18.9 MB row group in about 3 s.

## Known Gaps

- [ ] For consolidated stores read over HTTP, non-Zarr files are not listed;
      the details point at `shapes.parquet` and `points.parquet` instead.
- [ ] SpatialData points are a folder of Parquet parts, browsed one part at a
      time.
- [ ] Min and max are left out for binary columns, because hyparquet decodes
      every `BYTE_ARRAY` statistic as UTF-8.
- [ ] Writers that store each column chunk as one page (fastparquet) cost a
      whole row group for Rows.
- [ ] In a narrow window the drawer covers the open-dataset form until it is
      closed.
