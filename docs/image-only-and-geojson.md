# Image-Only Sources And GeoJSON Shapes

The viewer can load a direct image URL without any spatial transcriptomics
tables. This is useful for inspecting remote image pyramids, drawing or
importing geometric annotations, and checking a cell segmentation against
the image ([Imported Segmentations](#imported-segmentations)). For how images are read and rendered, see
[Image sources](./modalities/image.md).

## Supported Image URLs

Use `Dataset or image URL` with one of these direct URL forms:

- `.ome.tif`, `.ome.tiff`, `.tif`, or `.tiff`
- `.qptiff` or `.qptif` (Akoya PhenoCycler, PhenoImager, and Vectra), see
  below
- `.svs` (Aperio and Leica brightfield slides, usually H&E), see below
- `.ome.zarr`, `.zarr`, `zarr.json`, or `.zattrs`
- `.ndpi` (Hamamatsu NanoZoomer brightfield slides), see below
- A folder URL whose `zarr.json` or `.zattrs` holds OME multiscales metadata

A Zarr root whose attributes contain `spatialdata_attrs` loads as
[SpatialData](./modalities/spatialdata.md) instead of as an image.

TIFF requirements:

- Tiled or stripped. A stripped image is read in bands of whole rows, so
  tiled images load faster, and compressed strips that decode to more than
  256 MiB each are refused.
- Pyramid levels stored as `SubIFDs` of the base image, or, without
  OME-XML, as a [page pyramid](./modalities/image.md#page-pyramids): later
  top-level IFDs tiled with the first one's tile size, each smaller, as SVS
  stores them. Other top-level IFDs are not taken as levels; without a
  pyramid, only full resolution is shown.
- 8- or 16-bit samples with 1, 3, or 4 samples per pixel.
- Pixel size from OME-XML `PhysicalSizeX`. Without OME-XML the viewer assumes
  0.2125 µm per pixel.
- Z-stacks open at the middle z plane; `Z plane` in the Image section shows
  another.
  The OME-XML must locate each plane (`TiffData`, or none for planes stored in
  IFD order), and each plane needs its own `SubIFDs` pyramid. Only the first
  time point of an OME-TIFF is shown.

NDPI slides are also read as they come from the scanner: each pyramid level
is one large JPEG, which the viewer reads in bands of rows and decodes in
blocks, using the restart offsets the scanner writes. The pixel size comes
from the TIFF resolution tags, and a slide whose smallest level is still
large gets an extra level an eighth its size for the whole-slide view. An
NDPI saved under a `.tif` name is recognized from its NDPI tags. Files over
4 GB are not read; convert them to pyramidal OME-TIFF (for example with
`bfconvert`, or `bioformats2raw` and `raw2ometiff`). The macro image and
other focal planes are not shown. See [NDPI](./modalities/image.md#ndpi).

QPTIFF files are read as they come from the scanner: the pyramid levels stored
as top-level IFDs are used, each channel is named by its biomarker and drawn in
its scanner colour, and the pixel size comes from the TIFF resolution tags.
A QPTIFF saved under a `.tif` name is recognized from its image description.
See [QPTIFF](./modalities/image.md#qptiff).

SVS slides are also read as they come from the scanner, JPEG or JPEG 2000:
every tiled IFD is a pyramid level, the slide is shown in its own colours,
and the pixel size comes from `MPP` in the image description. An SVS saved
under a `.tif` name is recognized from its `Aperio` image description. The
info drawer (ⓘ) shows the slide's label, macro (the whole glass slide), and
thumbnail, each with a link that opens it on its own, and the minimap draws
the thumbnail. An Aperio fluorescence channel file is named by its dye and
drawn in its display colour; open the other channel files of the scan as
custom layers. See [SVS](./modalities/image.md#svs).

An image with more than six channels, such as a multiplexed QPTIFF, opens with
the first six channels on; turn others on in the Image section. Each is
auto-contrasted the first time it is turned on.

OME-Zarr sources must expose OME multiscales metadata with `x` and `y` axes.
An image without a `c` axis is one grayscale channel. A z-stack, with or
without a channel axis, opens on the plane its OMERO rendering settings name
(`omero.rdefs.defaultZ`), or the middle plane, and `Z plane` shows another;
the depth is shown when the `z` axis declares a length unit. `View` › `3D`
shows the whole z-stack in 3D at a resolution the GPU can hold. Each channel and
plane opens as a `#c=N&z=M` loader. An image with a `t` axis opens at
`omero.rdefs.defaultT`, or the first time point, and `Time point` shows
another at the same z plane.

## Platform Behavior

Image-only sources expose image channels, image opacity, custom image layers,
distance measurement, hover coordinates, ROI drawing, GeoJSON shape
annotations, and an imported segmentation drawn as outlines.

The app hides transcriptomics workflows because image-only sources have no cell
IDs, bins, molecules, or expression matrix:

- The Cells section (genes, clusters, embedding)
- The Transcripts section
- The Magic Lens tool
- Cell and Bin cards
- Cell-id annotation loading
- ROI cell, transcript, and gene export

## GeoJSON Shape Import

Open the layer panel's Annotations section and use `Import GeoJSON`. The
importer accepts a GeoJSON `FeatureCollection`, a `Feature`, a bare array of
features (as QuPath exports objects without `FEATURE_COLLECTION`), or a bare
geometry. Each Polygon or MultiPolygon feature, and the polygons of a
GeometryCollection, becomes a geometric annotation with label, color,
visibility, and remove controls; holes are kept.

Other features are skipped: points, lines, features with `null` geometry, and
QuPath detections, cells, tiles and TMA cores (open detections and cells in
the [Segmentation section](#imported-segmentations) to draw them as
outlines). A message under the buttons says how many of each were skipped,
or, when an import adds no shapes, why (for example "region.geojson has no
Polygon or MultiPolygon shapes. Skipped 2 points." or that the file is not
valid JSON). A polygon ring with fewer than three distinct points rejects the
whole file. The next import, or loading another dataset, clears the message.

The importer reads these optional properties:

- `label`, `name`, or `title` for the shape label, then the class name
  (default `Shape N`).
- `color`, `stroke`, or `fill` as a `#rrggbb` hex value, or `color` as
  QuPath writes it (`[r, g, b]` or a packed RGB integer), for the initial
  color. Without one, the class colour, then the palette.
- `classification`, QuPath's class: `{ "name": "Tumor", "color": [200, 0, 0] }`,
  a derived class `{ "names": ["Tumor", "Positive"], "color": … }`, QuPath
  0.2's `{ "name": …, "colorRGB": … }`, or a string such as
  `"Tumor: Positive"`. The shape list shows it beside the geometry.
- `objectType`: QuPath's `annotation` is imported (as is a feature without
  one); `detection`, `cell`, `tile` and `tmaCore` are skipped. QuPath 0.2's
  type names in the feature `id` (`PathDetectionObject`, …) are read too.
- `coordinate_unit` or `coordinateUnit` set to `pixel`, `pixels`, `px`,
  `micrometer`, `micrometers`, or `um` (case-insensitive).

The feature's `id`, such as QuPath's UUID, or else an `id` property, is kept
as the shape's identity; a shape without one, or drawn in the viewer, gets a
new UUID. Other properties, such as QuPath's `measurements`, `metadata` and
`isLocked`, are kept and written back on export. `visible` is not imported,
and QuPath's `plane` and `isEllipse` geometry members are not kept, so a
shape on another z plane shows on every plane.

### Shape Coordinates

`Shape coordinates`, shown when the dataset has an image, chooses the units of
imported features without `coordinate_unit`, and of exported shapes:

- `Image pixels`: the image's full-resolution pixels, from its top-left
  corner, as QuPath writes and reads them. They are placed as the image is:
  by its pixel size, its origin (a MERSCOPE mosaic's stage position, say), and
  any flip or axis swap a SpatialData image has.
- `Micrometres`: the viewer's own coordinates.

It starts on Image pixels for image-only sources and on Micrometres
otherwise. Without an image, coordinates are micrometres. To exchange
annotations of a Xenium or other slide with QuPath, choose Image pixels and
open the image the viewer shows in QuPath, so both use its pixels.

## Imported Segmentations

The layer panel's Segmentation section imports a cell segmentation onto the
image and draws it as outlines, such as Cellpose masks over an NDPI slide.
Enter its URL and `Load`, or `Open File` for a local file. It is outlines
only: there is no cell table, so the outlines do not colour by genes or
classes, and ROI, the Cell card and Cell Query do not count them. One
segmentation is open at a time, and opening another dataset drops it.

| Format         | Names                                       | What is read                                                                                                                                                                                                                                                                                                              |
| -------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Label TIFF     | `.tif`, `.tiff`, `.ome.tif`                 | An integer mask, 0 background, one label per cell: 8-, 16- or 32-bit, unsigned (Cellpose's `_cp_masks.tif`, which is 32-bit over 65,535 cells) or signed, or 32-bit float holding whole numbers. Tiled or stripped; uncompressed, LZW or Deflate, with or without a predictor. Pyramid levels as `SubIFDs`, as for images |
| Label OME-Zarr | `.zarr`, `zarr.json`, `.zattrs`             | An OME-Zarr label image, including a `bioformats2raw` store, read as an [AnnData `labels`](./dataset-collections.md#labels) image is. From a URL only                                                                                                                                                                     |
| GeoJSON        | `.geojson`, `.json`, gzipped too            | A FeatureCollection, or a bare array of features as QuPath exports them, read as it downloads, one feature at a time. Polygon and MultiPolygon features; others are skipped. Other JSON, such as newline-delimited features, is refused once its first object closes                                                      |
| WKT            | `.wkt`, `.csv`, `.tsv`, `.txt`, gzipped too | One WKT `POLYGON` or `MULTIPOLYGON` a line, or a comma, tab or semicolon table: the geometry column is named (`geometry`, `wkt`, `polygon`, `boundary`, `outline`, …) or is the first whose values are WKT. WKT left unquoted in a CSV is read too. 2D to 4D, and EWKT `SRID=n;`                                          |
| Parquet        | `.parquet`, `.geoparquet`, `.pq`            | GeoParquet WKB (its `primary_column`), a `geometry` or `wkt` column of WKB or WKT, or one row per vertex (`cell_id` with `vertex_x` and `vertex_y`, or `x` and `y`) as Xenium's `cell_boundaries.parquet`, a cell's rows together                                                                                         |

Choose `Format` when the name has no such extension, as for a signed
download link. Only outer rings are kept: holes are dropped, and a
MultiPolygon keeps its largest polygon.

Each outline's ID, shown on hover with its vertices and area, is a mask's
label value, or for polygons the first of these that the file has:

- GeoJSON: the `cell_id`, `cellId`, `label`, `label_id` or `id` property,
  then the feature's own `id` (QuPath's UUID), then `object_id`, `objectId`
  or `name`.
- Tables and Parquet: a named pandas index column, or a column named
  `cell_id`, `cell`, `label_id`, `label`, `entityid`, `id`, `object_id`,
  `instance_id`, `name` or `barcode` (any case), in that order, else an
  unnamed pandas index (`__index_level_0__`, the row labels of a filtered
  frame). A CSV's unnamed first column is pandas' index. A header cell named
  `polygon` or `geometry` is a header, not a value.
- Otherwise the row or feature number, from 0.

### Placement

- **Label masks** cover the image. A mask on the image's own pixel grid
  lines up pixel for pixel; a smaller one, such as Cellpose run on a
  downsampled image, is stretched to fit. The section says so when the mask
  is not the image's shape.
- **Polygons** are in full-resolution image pixels by default, as Cellpose,
  QuPath and StarDist write them, and placed by the image's pixel size: its
  width for x and its height for y, which differ for some OME-Zarr images.
  Choose `Coordinates` › `Micrometres` for micrometre files such as
  Xenium's. The section warns when the outlines reach beyond the image, or
  cover only its top-left part, which usually means the other units.

### Drawing

Outlines are read for the view, as cell boundaries are, and drawn only while
the view holds fewer than the Boundary limit (Settings; 50,000 by default).
Otherwise the section says to zoom in, and how many outlines are in view.

- **Polygons** are read once, in a worker, into columns (a million 12-vertex
  polygons take about 250 MB of browser memory). Each view selects those whose
  bounds meet it, so the count in view is exact.
- **Masks** are traced for the view in the tile decode workers, from the
  finest pyramid level whose pixels in view fit 16 million, and never from a
  level more than 4 times coarser than the mask, where cells are a few pixels.
  Until a level fits, the section says `Zoom in to trace the mask's
outlines`. How many cells a view holds is known only once it is traced;
  after the first trace, the density traced estimates it, and a trace with
  more labels than the limit draws none.

The outline colour and opacity are the section's own. A link keeps the
segmentation's URL (`segmentation=`), not a picked file. A
[dataset manifest](./dataset-manifest.md#h5ad-spatialdata-and-image) can
name one for an image with `files.segmentation`.

On a synthetic 6,000 × 6,000 pixel slide with 81,900 cells, served locally,
every format opened in 2–3 s and a view of 2,576 cells drew in under a
second. A million polygons opened in 2.3 s as GeoParquet (142 MB) and 3.3 s as
WKT CSV (226 MB) (headless Chromium with the GPU).

### Masks For Whole Slides

Cellpose writes `_cp_masks.tif` in compressed strips of whole rows, without a
pyramid. It opens, but every view decodes whole rows across the slide, and
only views up to 16 million mask pixels (about 4,000 pixels square) are
traced. For a whole slide, save the mask tiled with a pyramid, downsampling
by taking every other pixel so labels stay whole:

```python
import tifffile

mask = tifffile.imread('slide_cp_masks.tif')
with tifffile.TiffWriter('slide_masks.ome.tif', bigtiff=True) as tif:
    options = dict(tile=(512, 512), compression='zlib')
    tif.write(mask, subifds=4, metadata={'axes': 'YX'}, **options)
    level = mask
    for _ in range(4):
        level = level[::2, ::2]
        tif.write(level, subfiletype=1, **options)
```

The host must allow CORS, and Range requests for TIFF, OME-Zarr and Parquet,
which are read in parts; GeoJSON and WKT are read whole as they arrive.

## ROI And Export

On image-only sources, pick the Box selection (`R`) or Lasso selection (`L`)
tool. A New shape card opens: optionally set `Shape name`, and draw on the
image. Completing the drawing saves the geometry as a GeoJSON shape in the
Annotations section instead of querying cells or genes.

Use `Export GeoJSON` in the Annotations section to download all loaded
geometric annotations as `geometric-annotations.geojson`, in the units
`Shape coordinates` names, with `coordinate_unit` set so the file imports
back the same way. Each feature is written as QuPath reads an annotation: the
shape's UUID as the feature `id`, `objectType: "annotation"`, the label as
`name`, its class as `classification` (always with a colour, which QuPath
requires), and its colour as `color` `[r, g, b]` unless it is the class
colour. Exported in Image pixels, the file opens in QuPath over the same
image.
