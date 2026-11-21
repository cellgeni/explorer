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
        ifdIndex: 0,
        purpose: 'Nuclear',
      },
      {
        id: 'Channel:1',
        index: 1,
        name: 'ATP1A1/CD45/E-Cadherin',
        color: [32, 166, 122],
        contrast: { min: 0, max: 65_535 },
        fileName: 'morphology_focus_0001.ome.tif',
        ifdIndex: 0,
        purpose: 'Boundary',
      },
      {
        id: 'Channel:2',
        index: 2,
        name: '18S',
        color: [240, 200, 75],
        contrast: { min: 0, max: 65_535 },
        fileName: 'morphology_focus_0002.ome.tif',
        ifdIndex: 0,
        purpose: 'Interior - RNA',
      },
      {
        id: 'Channel:3',
        index: 3,
        name: 'alphaSMA/Vimentin',
        color: [215, 63, 124],
        contrast: { min: 0, max: 65_535 },
        fileName: 'morphology_focus_0003.ome.tif',
        ifdIndex: 0,
        purpose: 'Interior - Protein',
      },
    ])
  })

  it('decodes explicit OME channel colors as signed RGBA integers', () => {
    const metadata = parseOmeTiffMetadata(`
<OME xmlns="http://www.openmicroscopy.org/Schemas/OME/2016-06">
  <Image ID="Image:0">
    <Pixels Type="uint8" PhysicalSizeX="1.5">
      <Channel ID="Channel:0" Name="Red" Color="-16776961"/>
      <Channel ID="Channel:1" Name="Green" Color="16711935"/>
      <Channel ID="Channel:2" Name="Blue" Color="65535"/>
    </Pixels>
  </Image>
</OME>`)

    expect(metadata.channels).toEqual([
      {
        id: 'Channel:0',
        index: 0,
        name: 'Red',
        color: [255, 0, 0],
        contrast: { min: 0, max: 255 },
        ifdIndex: 0,
      },
      {
        id: 'Channel:1',
        index: 1,
        name: 'Green',
        color: [0, 255, 0],
        contrast: { min: 0, max: 255 },
        ifdIndex: 1,
      },
      {
        id: 'Channel:2',
        index: 2,
        name: 'Blue',
        color: [0, 0, 255],
        contrast: { min: 0, max: 255 },
        ifdIndex: 2,
      },
    ])
  })

  it('marks interleaved RGB OME-TIFF channels as true-color single channels', () => {
    const metadata = parseOmeTiffMetadata(`<?xml version="1.0" encoding="UTF-8"?>
<OME xmlns="http://www.openmicroscopy.org/Schemas/OME/2016-06">
  <Image ID="Image:0">
    <Pixels DimensionOrder="XYZCT" Type="uint8" SizeX="2" SizeY="2" SizeZ="1" SizeC="3" SizeT="1" Interleaved="true" PhysicalSizeX="0.5" PhysicalSizeY="0.5">
      <Channel ID="Channel:0:0" SamplesPerPixel="3"><LightPath/></Channel>
      <TiffData IFD="0" PlaneCount="1"/>
    </Pixels>
  </Image>
</OME>`)

    expect(metadata.channels).toHaveLength(1)
    expect(metadata.channels[0]).toEqual({
      id: 'Channel:0:0',
      index: 0,
      name: 'Channel 1',
      color: [255, 255, 255],
      contrast: { min: 0, max: 255 },
      samplesPerPixel: 3,
      ifdIndex: 0,
      alphaFromIntensity: false,
    })
  })

  it('keeps single-sample OME channels additive-only', () => {
    const metadata = parseOmeTiffMetadata(`
<OME xmlns="http://www.openmicroscopy.org/Schemas/OME/2016-06">
  <Image ID="Image:0">
    <Pixels Type="uint8" Interleaved="true">
      <Channel ID="Channel:0" Name="DAPI" SamplesPerPixel="1"/>
    </Pixels>
  </Image>
</OME>`)

    expect(metadata.channels[0]).not.toHaveProperty('samplesPerPixel')
    expect(metadata.channels[0]).not.toHaveProperty('alphaFromIntensity')
  })

  it('maps OME TiffData plane runs to per-channel IFD indices', () => {
    const metadata = parseOmeTiffMetadata(`
<OME xmlns="http://www.openmicroscopy.org/Schemas/OME/2016-06">
  <Image ID="Image:0">
    <Pixels DimensionOrder="XYZCT" Type="uint8" SizeZ="1" SizeT="1" SizeC="3" PhysicalSizeX="0.5">
      <Channel ID="Channel:0:0" SamplesPerPixel="1"/>
      <Channel ID="Channel:0:1" SamplesPerPixel="1"/>
      <Channel ID="Channel:0:2" SamplesPerPixel="1"/>
      <TiffData IFD="0" PlaneCount="3"/>
    </Pixels>
  </Image>
</OME>`)

    expect(metadata.channels.map((channel) => channel.ifdIndex)).toEqual([0, 1, 2])
    expect(metadata.channels.map((channel) => channel.name)).toEqual([
      'Channel 1',
      'Channel 2',
      'Channel 3',
    ])
  })

  // OME-TIFF defaults TiffData's IFD to 0 and its PlaneCount to every
  // remaining plane, and stores plane N in IFD N when there is no TiffData.
  it('applies the TiffData defaults to 2D images (EXP-045)', () => {
    const ifdIndices = (tiffData: string) =>
      parseOmeTiffMetadata(`<OME>
  <Image ID="Image:0">
    <Pixels DimensionOrder="XYCZT" Type="uint16" SizeX="16" SizeY="16" SizeZ="1" SizeC="3" SizeT="1">
      <Channel ID="Channel:0:0"/>
      <Channel ID="Channel:0:1"/>
      <Channel ID="Channel:0:2"/>
      ${tiffData}
    </Pixels>
  </Image>
</OME>`).channels.map((channel) => channel.ifdIndex)

    expect(ifdIndices('<TiffData/>')).toEqual([0, 1, 2])
    expect(ifdIndices('')).toEqual([0, 1, 2])
    expect(
      ifdIndices('<TiffData IFD="3"/><TiffData FirstC="1" IFD="5" PlaneCount="2"/>'),
    ).toEqual([3, 5, 6])
  })

  it('finds a 2D channel at t = 0 when time varies faster than channel', () => {
    const metadata = parseOmeTiffMetadata(`<OME>
  <Image ID="Image:0">
    <Pixels DimensionOrder="XYZTC" Type="uint16" SizeX="16" SizeY="16" SizeZ="1" SizeC="2" SizeT="3">
      <Channel ID="Channel:0:0"/>
      <Channel ID="Channel:0:1"/>
      <TiffData IFD="0" PlaneCount="6"/>
    </Pixels>
  </Image>
</OME>`)

    expect(metadata.channels.map((channel) => channel.ifdIndex)).toEqual([0, 3])
  })

  it('indexes channels by element order, not by the number in their IDs (EXP-045)', () => {
    const metadata = parseOmeTiffMetadata(`<OME>
  <Image ID="Image:0">
    <Pixels DimensionOrder="XYCZT" Type="uint16" SizeX="16" SizeY="16" SizeZ="1" SizeC="3" SizeT="1">
      <Channel ID="Channel:0:1" Name="A"/>
      <Channel ID="Channel:0:2" Name="B"/>
      <Channel ID="Channel:0:3" Name="C"/>
      <TiffData IFD="0" PlaneCount="3"/>
    </Pixels>
  </Image>
</OME>`)

    expect(
      metadata.channels.map(({ id, index, ifdIndex }) => ({ id, index, ifdIndex })),
    ).toEqual([
      { id: 'Channel:0:1', index: 0, ifdIndex: 0 },
      { id: 'Channel:0:2', index: 1, ifdIndex: 1 },
      { id: 'Channel:0:3', index: 2, ifdIndex: 2 },
    ])
  })

  it('falls back to the Xenium pixel size when OME metadata is missing', () => {
    expect(parseOmeTiffMetadata(undefined)).toEqual({
      micrometersPerPixel: 0.2125,
      channels: [],
    })
    expect(parsePhysicalSizeMicrometersPerPixel('PhysicalSizeX="-1"')).toBe(0.2125)
  })

  it('converts OME physical size units to micrometers per pixel', () => {
    expect(
      parsePhysicalSizeMicrometersPerPixel(
        'PhysicalSizeX="0.00002125" PhysicalSizeXUnit="cm"',
      ),
    ).toBeCloseTo(0.2125)
    expect(
      parsePhysicalSizeMicrometersPerPixel(
        'PhysicalSizeX="0.0002125" PhysicalSizeXUnit="mm"',
      ),
    ).toBeCloseTo(0.2125)
    expect(
      parsePhysicalSizeMicrometersPerPixel(
        'PhysicalSizeX="212.5" PhysicalSizeXUnit="nm"',
      ),
    ).toBeCloseTo(0.2125)
    expect(
      parsePhysicalSizeMicrometersPerPixel(
        'PhysicalSizeX="0.2125" PhysicalSizeXUnit="um"',
      ),
    ).toBeCloseTo(0.2125)
  })

  it('converts OME physical sizes in angstroms, picometres and inches', () => {
    expect(
      parsePhysicalSizeMicrometersPerPixel('PhysicalSizeX="2125" PhysicalSizeXUnit="Å"'),
    ).toBeCloseTo(0.2125)
    expect(
      parsePhysicalSizeMicrometersPerPixel(
        'PhysicalSizeX="212500" PhysicalSizeXUnit="pm"',
      ),
    ).toBeCloseTo(0.2125)
    expect(
      parsePhysicalSizeMicrometersPerPixel(
        'PhysicalSizeX="0.0001" PhysicalSizeXUnit="in"',
      ),
    ).toBeCloseTo(2.54)
  })

  it('handles tifffile resolution-like OME physical size values', () => {
    expect(
      parsePhysicalSizeMicrometersPerPixel(
        'PhysicalSizeX="45206" PhysicalSizeXUnit="cm"',
      ),
    ).toBeCloseTo(10_000 / 45_206)
  })

  it('maps a Xenium z-stack with one TiffData to consecutive IFDs', () => {
    const metadata =
      parseOmeTiffMetadata(`<OME xmlns="http://www.openmicroscopy.org/Schemas/OME/2016-06">
  <Image ID="Image:0">
    <Pixels ID="Pixels:0" DimensionOrder="XYZCT" Type="uint16" SizeX="51294" SizeY="88404" SizeZ="13" SizeC="1" SizeT="1" PhysicalSizeX="0.2125" PhysicalSizeXUnit="µm" PhysicalSizeZ="3.0" PhysicalSizeZUnit="µm">
      <Channel ID="Channel:0" Name="DAPI" SamplesPerPixel="1"/>
      <TiffData PlaneCount="13"/>
    </Pixels>
  </Image>
</OME>`)

    expect(metadata.zStack).toEqual({ sizeZ: 13, micrometersPerPlane: 3 })
    expect(metadata.channels[0]?.ifdIndex).toBe(0)
    expect(metadata.channels[0]?.zPlanes?.map((plane) => plane.ifdIndex)).toEqual(
      Array.from({ length: 13 }, (_, z) => z),
    )
  })

  it('maps per-plane TiffData of a multi-channel z-stack in dimension order', () => {
    const tiffData = [0, 1]
      .flatMap((c) =>
        [0, 1, 2].map(
          (z) =>
            `<TiffData FirstC="${c.toString()}" FirstZ="${z.toString()}" FirstT="0" IFD="${(c + 2 * z).toString()}" PlaneCount="1"/>`,
        ),
      )
      .reverse()
      .join('')
    const metadata =
      parseOmeTiffMetadata(`<OME xmlns="http://www.openmicroscopy.org/Schemas/OME/2016-06">
  <Image ID="Image:0">
    <Pixels DimensionOrder="XYCZT" Type="uint8" SizeX="64" SizeY="64" SizeZ="3" SizeC="2" SizeT="2" PhysicalSizeZ="500" PhysicalSizeZUnit="nm">
      <Channel ID="Channel:0:0" Name="A"/>
      <Channel ID="Channel:0:1" Name="B"/>
      ${tiffData}
    </Pixels>
  </Image>
</OME>`)

    expect(metadata.zStack).toEqual({ sizeZ: 3, micrometersPerPlane: 0.5 })
    expect(metadata.channels.map((channel) => channel.ifdIndex)).toEqual([0, 1])
    expect(
      metadata.channels.map((channel) => channel.zPlanes?.map((plane) => plane.ifdIndex)),
    ).toEqual([
      [0, 2, 4],
      [1, 3, 5],
    ])
  })

  it('maps z-stack planes without TiffData, and across files by UUID', () => {
    const withoutTiffData = parseOmeTiffMetadata(`<OME>
  <Image ID="Image:0">
    <Pixels DimensionOrder="XYZCT" Type="uint16" SizeX="64" SizeY="64" SizeZ="2" SizeC="2" SizeT="1">
      <Channel ID="Channel:0:0"/>
      <Channel ID="Channel:0:1"/>
    </Pixels>
  </Image>
</OME>`)
    const multiFile = parseOmeTiffMetadata(`<OME>
  <Image ID="Image:0">
    <Pixels DimensionOrder="XYZCT" Type="uint16" SizeX="64" SizeY="64" SizeZ="2" SizeC="2" SizeT="1">
      <Channel ID="Channel:0:0"/>
      <Channel ID="Channel:0:1"/>
      <TiffData FirstC="0" IFD="0" PlaneCount="2"><UUID FileName="c0.ome.tif">urn:uuid:0</UUID></TiffData>
      <TiffData FirstC="1" IFD="0" PlaneCount="2"><UUID FileName="c1.ome.tif">urn:uuid:1</UUID></TiffData>
    </Pixels>
  </Image>
</OME>`)

    expect(withoutTiffData.zStack).toEqual({ sizeZ: 2 })
    expect(withoutTiffData.channels.map((channel) => channel.zPlanes)).toEqual([
      [{ ifdIndex: 0 }, { ifdIndex: 1 }],
      [{ ifdIndex: 2 }, { ifdIndex: 3 }],
    ])
    expect(multiFile.channels[1]).toMatchObject({
      fileName: 'c1.ome.tif',
      ifdIndex: 0,
      zPlanes: [
        { ifdIndex: 0, fileName: 'c1.ome.tif' },
        { ifdIndex: 1, fileName: 'c1.ome.tif' },
      ],
    })
  })

  it('reports no z-stack for 2D images or unlocated planes', () => {
    const flat = parseOmeTiffMetadata(`<OME>
  <Image ID="Image:0">
    <Pixels DimensionOrder="XYZCT" Type="uint16" SizeX="64" SizeY="64" SizeZ="1" SizeC="1" SizeT="1" PhysicalSizeZ="3">
      <Channel ID="Channel:0"/>
    </Pixels>
  </Image>
</OME>`)
    const partial = parseOmeTiffMetadata(`<OME>
  <Image ID="Image:0">
    <Pixels DimensionOrder="XYZCT" Type="uint16" SizeX="64" SizeY="64" SizeZ="3" SizeC="1" SizeT="1">
      <Channel ID="Channel:0"/>
      <TiffData IFD="0" PlaneCount="2"/>
    </Pixels>
  </Image>
</OME>`)

    expect(flat.zStack).toBeUndefined()
    expect(flat.channels[0]?.zPlanes).toBeUndefined()
    expect(partial.zStack).toBeUndefined()
    expect(partial.channels[0]?.zPlanes).toBeUndefined()
  })
})
