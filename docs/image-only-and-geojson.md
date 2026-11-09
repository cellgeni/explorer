# Image-Only Sources And GeoJSON Shapes

The viewer can load a direct image URL without any spatial transcriptomics
tables. This is useful for inspecting remote image pyramids and drawing or
importing geometric annotations. For how images are read and rendered, see
[Image sources](./modalities/image.md).

## Supported Image URLs

Use `Dataset or image URL` with one of these direct URL forms:

- `.ome.tif`, `.ome.tiff`, `.tif`, or `.tiff`
- `.ome.zarr`, `.zarr`, `zarr.json`, or `.zattrs`
- `.ndpi`, read with the same TIFF loader (see the requirements below)
- A folder URL whose `zarr.json` or `.zattrs` holds OME multiscales metadata

A Zarr root whose attributes contain `spatialdata_attrs` loads as
[SpatialData](./modalities/spatialdata.md) instead of as an image.

TIFF requirements:

- Tiled, not stripped. Stripped TIFFs open but no tiles load.
- Pyramid levels stored as `SubIFDs` of the base image. Pyramids stored as
  extra top-level IFDs are ignored, so only full resolution is shown.
- 8- or 16-bit samples with 1, 3, or 4 samples per pixel.
- Pixel size from OME-XML `PhysicalSizeX`. Without OME-XML the viewer assumes
  0.2125 µm per pixel.
- Z-stacks open at the middle z plane; `Layers` → `Z plane` shows another.
  The OME-XML must locate each plane (`TiffData`, or none for planes stored in
  IFD order), and each plane needs its own `SubIFDs` pyramid. Only the first
  time point is shown.

Most NDPI files do not meet these requirements; convert them to pyramidal
OME-TIFF (for example with `bfconvert` or `bioformats2raw` + `raw2ometiff`)
and host that output instead.

OME-Zarr sources must expose OME multiscales metadata with `x` and `y` axes.
Only the first time point and z plane of an OME-Zarr image are shown.

## Platform Behavior

Image-only sources expose image channels, image opacity, custom image layers,
distance measurement, hover coordinates, ROI drawing, and GeoJSON shape
annotations.

The app hides transcriptomics workflows because image-only sources have no cell
IDs, bins, molecules, or expression matrix:

- Genes
- Transcripts
- Magic Lens
- Cell or Bin Info
- Cell-id annotation loading
- ROI cell, transcript, and gene export

## GeoJSON Shape Import

Open the `Annotations` tab and use `Import GeoJSON`. The importer accepts a
GeoJSON `Feature` or `FeatureCollection` with Polygon or MultiPolygon geometry.
Each imported feature becomes a geometric annotation with label, color,
visibility, and remove controls. Features with `null` geometry are skipped; any
other geometry type (Point, LineString, …) rejects the whole file. A failed
import only adds "GeoJSON annotation import failed" to the Dataset tab log; the
reason is not shown.

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

On image-only sources the `ROI` tab shows the `Geometry` panel. Use
`Draw Box` or `Draw Lasso`, optionally set `Shape name`, and draw on the image.
Completing the drawing saves the geometry as a GeoJSON shape in the
`Annotations` tab instead of querying cells or genes.

Use `Export GeoJSON` in the `Annotations` tab to download all loaded geometric
annotations as `geometric-annotations.geojson`. Exported features use
`coordinate_unit = "micrometer"` (also for image-only sources) so they
round-trip in viewer coordinates.
