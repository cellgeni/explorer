# Image-Only Sources And GeoJSON Shapes

The viewer can load a direct image URL without any spatial transcriptomics
tables. This is useful for inspecting remote image pyramids and drawing or
importing geometric annotations. For how images are read and rendered, see
[Image sources](./modalities/image.md).

## Supported Image URLs

Use `Dataset or image URL` with one of these direct URL forms:

- `.ome.tif`, `.ome.tiff`, `.tif`, or `.tiff`
- `.qptiff` or `.qptif` (Akoya PhenoCycler, PhenoImager, and Vectra), see
  below
- `.svs` (Aperio and Leica brightfield slides, usually H&E), see below
- `.ome.zarr`, `.zarr`, `zarr.json`, or `.zattrs`
- `.ndpi`, read with the same TIFF loader (see the requirements below)
- A folder URL whose `zarr.json` or `.zattrs` holds OME multiscales metadata

A Zarr root whose attributes contain `spatialdata_attrs` loads as
[SpatialData](./modalities/spatialdata.md) instead of as an image.

TIFF requirements:

- Tiled or stripped. A stripped image is read in bands of whole rows, so
  tiled images load faster, and compressed strips that decode to more than
  256 MiB each are refused.
- Pyramid levels stored as `SubIFDs` of the base image. Pyramids stored as
  extra top-level IFDs are ignored, so only full resolution is shown.
- 8- or 16-bit samples with 1, 3, or 4 samples per pixel.
- Pixel size from OME-XML `PhysicalSizeX`. Without OME-XML the viewer assumes
  0.2125 µm per pixel.
- Z-stacks open at the middle z plane; `Z plane` in the Image section shows
  another.
  The OME-XML must locate each plane (`TiffData`, or none for planes stored in
  IFD order), and each plane needs its own `SubIFDs` pyramid. Only the first
  time point is shown.

Most NDPI files do not meet these requirements; convert them to pyramidal
OME-TIFF (for example with `bfconvert` or `bioformats2raw` + `raw2ometiff`)
and host that output instead.

QPTIFF files are read as they come from the scanner: the pyramid levels stored
as top-level IFDs are used, each channel is named by its biomarker and drawn in
its scanner colour, and the pixel size comes from the TIFF resolution tags.
A QPTIFF saved under a `.tif` name is recognized from its image description.
See [QPTIFF](./modalities/image.md#qptiff).

SVS slides are also read as they come from the scanner, JPEG or JPEG 2000:
every tiled IFD is a pyramid level, the slide is shown in its own colours,
and the pixel size comes from `MPP` in the image description. An SVS saved
under a `.tif` name is recognized from its `Aperio` image description. The
thumbnail, label, and macro images are not shown. See
[SVS](./modalities/image.md#svs).

An image with more than six channels, such as a multiplexed QPTIFF, opens with
the first six channels on; turn others on in the Image section. Each is
auto-contrasted the first time it is turned on.

OME-Zarr sources must expose OME multiscales metadata with `x` and `y` axes.
A z-stack with a channel axis opens on the plane its OMERO rendering settings
name (`omero.rdefs.defaultZ`), or the middle plane, and `Z plane` shows
another; the depth is shown when the `z` axis declares a length unit. Each
channel and plane opens as a `#c=N&z=M` loader. Only one time point is shown:
`omero.rdefs.defaultT`, or the first.

## Platform Behavior

Image-only sources expose image channels, image opacity, custom image layers,
distance measurement, hover coordinates, ROI drawing, and GeoJSON shape
annotations.

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
importer accepts a GeoJSON `Feature` or `FeatureCollection` with Polygon or
MultiPolygon geometry. Each imported feature becomes a geometric annotation
with label, color, visibility, and remove controls. Features with `null`
geometry are skipped; any other geometry type (Point, LineString, …) rejects
the whole file. When an import adds no shapes, a message under the buttons says
why (for example "Could not import region.geojson. GeoJSON geometry must be
Polygon or MultiPolygon.", or that the file is not valid JSON or has no
polygons). The next import, or loading another dataset, clears it.

The importer reads these optional properties:

- `label`, `name`, or `title` for the shape label (default `Shape N`).
- `color`, `stroke`, or `fill` for the initial color. The first non-empty one
  is used and must be a `#rrggbb` hex value; anything else falls back to the
  palette.
- `coordinate_unit` or `coordinateUnit` set to `pixel`, `pixels`, `px`,
  `micrometer`, `micrometers`, or `um` (case-insensitive).

`id` and `visible` properties are not imported.

For image-only sources, coordinates default to pixels and are converted through
the image micrometers-per-pixel scale. For other platforms, coordinates default
to micrometers. Set `properties.coordinate_unit = "micrometer"` when the
coordinates are already in viewer coordinates.

## ROI And Export

On image-only sources, pick the Box selection (`R`) or Lasso selection (`L`)
tool. A New shape card opens: optionally set `Shape name`, and draw on the
image. Completing the drawing saves the geometry as a GeoJSON shape in the
Annotations section instead of querying cells or genes.

Use `Export GeoJSON` in the Annotations section to download all loaded
geometric annotations as `geometric-annotations.geojson`. Exported features use
`coordinate_unit = "micrometer"` (also for image-only sources) so they
round-trip in viewer coordinates.
