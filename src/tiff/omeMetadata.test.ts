import { describe, expect, it } from 'vitest'
import { parseOmeTiffMetadata, parsePhysicalSizeMicrometersPerPixel } from './omeMetadata'

describe('OME-TIFF metadata parsing', () => {
  it('extracts Xenium focus channel names, file names, colors, and contrast', () => {
    const metadata = parseOmeTiffMetadata(`<?xml version="1.0"?>
<OME xmlns="http://www.openmicroscopy.org/Schemas/OME/2016-06">
  <Image ID="Image:0">
    <Pixels DimensionOrder="XYZCT" Type="uint16" SizeX="51294" SizeY="88404" SizeZ="1" SizeC="4" SizeT="1" PhysicalSizeX="0.2125" PhysicalSizeY="0.2125">
      <Channel ID="Channel:0" Name="DAPI" SamplesPerPixel="1">
        <AnnotationRef ID="Annotation:0"/>
      </Channel>
      <Channel ID="Channel:1" Name="ATP1A1/CD45/E-Cadherin" SamplesPerPixel="1">
        <AnnotationRef ID="Annotation:1"/>
      </Channel>
      <Channel ID="Channel:2" Name="18S" SamplesPerPixel="1">
        <AnnotationRef ID="Annotation:2"/>
      </Channel>
      <Channel ID="Channel:3" Name="alphaSMA/Vimentin" SamplesPerPixel="1">
        <AnnotationRef ID="Annotation:3"/>
      </Channel>
      <TiffData FirstZ="0" FirstT="0" FirstC="0" PlaneCount="1">
        <UUID FileName="morphology_focus_0000.ome.tif">urn:uuid:0</UUID>
      </TiffData>
      <TiffData FirstZ="0" FirstT="0" FirstC="1" PlaneCount="1">
        <UUID FileName="morphology_focus_0001.ome.tif">urn:uuid:1</UUID>
      </TiffData>
      <TiffData FirstZ="0" FirstT="0" FirstC="2" PlaneCount="1">
        <UUID FileName="morphology_focus_0002.ome.tif">urn:uuid:2</UUID>
      </TiffData>
      <TiffData FirstZ="0" FirstT="0" FirstC="3" PlaneCount="1">
        <UUID FileName="morphology_focus_0003.ome.tif">urn:uuid:3</UUID>
      </TiffData>
    </Pixels>
  </Image>
  <StructuredAnnotations>
    <MapAnnotation ID="Annotation:0"><Value><M K="Purpose">Nuclear</M></Value></MapAnnotation>
    <MapAnnotation ID="Annotation:1"><Value><M K="Purpose">Boundary</M></Value></MapAnnotation>
    <MapAnnotation ID="Annotation:2"><Value><M K="Purpose">Interior - RNA</M></Value></MapAnnotation>
    <MapAnnotation ID="Annotation:3"><Value><M K="Purpose">Interior - Protein</M></Value></MapAnnotation>
  </StructuredAnnotations>
</OME>`)

    expect(metadata.micrometersPerPixel).toBe(0.2125)
    expect(metadata.channels).toEqual([
      {
        id: 'Channel:0',
        index: 0,
        name: 'DAPI',
        color: [88, 144, 255],
        contrast: { min: 0, max: 65_535 },
        fileName: 'morphology_focus_0000.ome.tif',
        purpose: 'Nuclear',
      },
      {
        id: 'Channel:1',
        index: 1,
        name: 'ATP1A1/CD45/E-Cadherin',
        color: [32, 166, 122],
        contrast: { min: 0, max: 65_535 },
        fileName: 'morphology_focus_0001.ome.tif',
        purpose: 'Boundary',
      },
      {
        id: 'Channel:2',
        index: 2,
        name: '18S',
        color: [240, 200, 75],
        contrast: { min: 0, max: 65_535 },
        fileName: 'morphology_focus_0002.ome.tif',
        purpose: 'Interior - RNA',
      },
      {
        id: 'Channel:3',
        index: 3,
        name: 'alphaSMA/Vimentin',
        color: [215, 63, 124],
        contrast: { min: 0, max: 65_535 },
        fileName: 'morphology_focus_0003.ome.tif',
        purpose: 'Interior - Protein',
      },
    ])
  })

  it('uses explicit OME channel color values when available', () => {
    const metadata = parseOmeTiffMetadata(`
<OME xmlns="http://www.openmicroscopy.org/Schemas/OME/2016-06">
  <Image ID="Image:0">
    <Pixels Type="uint8" PhysicalSizeX="1.5">
      <Channel ID="Channel:0" Name="Custom" Color="16711935"/>
    </Pixels>
  </Image>
</OME>`)

    expect(metadata.channels).toEqual([
      {
        id: 'Channel:0',
        index: 0,
        name: 'Custom',
        color: [255, 0, 255],
        contrast: { min: 0, max: 255 },
      },
    ])
  })

  it('falls back to the Xenium pixel size when OME metadata is missing', () => {
    expect(parseOmeTiffMetadata(undefined)).toEqual({
      micrometersPerPixel: 0.2125,
      channels: [],
    })
    expect(parsePhysicalSizeMicrometersPerPixel('PhysicalSizeX="-1"')).toBe(0.2125)
  })
})
