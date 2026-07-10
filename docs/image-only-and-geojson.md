# Image-Only Sources And GeoJSON Shapes

The viewer can load a direct image URL without any spatial transcriptomics
tables. This is useful for inspecting remote image pyramids and drawing or
importing geometric annotations.

## Supported Image URLs

Use `Dataset or image URL` with one of these direct URL forms:

- `.ome.tif`, `.ome.tiff`, `.tif`, or `.tiff`
- `.ome.zarr`, `.zarr`, `zarr.json`, or `.zattrs`
- `.ndpi` when the browser TIFF loader can read the specific variant

OME-TIFF and TIFF sources should be tiled pyramids for responsive navigation.
OME-Zarr sources must expose OME multiscales metadata. If an NDPI file fails to
open, convert it to pyramidal OME-TIFF and host that output instead.

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
visibility, and remove controls.

The importer reads these optional properties:

- `label`, `name`, or `title` for the shape label.
- `color`, `stroke`, or `fill` for the initial color.
- `coordinate_unit` or `coordinateUnit` set to `pixel`, `micrometer`, `px`, or
  `um`.

For image-only sources, coordinates default to pixels and are converted through
the image micrometers-per-pixel scale. For other platforms, coordinates default
to micrometers. Set `properties.coordinate_unit = "micrometer"` when the
coordinates are already in viewer coordinates.

## ROI And Export

Use the `ROI` tab to draw a box or lasso on image-only sources. Completing the
ROI saves the drawn geometry as a GeoJSON shape instead of querying cells or
genes.

Use `Export GeoJSON` to download all loaded geometric annotations. Exported
features use `coordinate_unit = "micrometer"` so they round-trip in viewer
coordinates.
