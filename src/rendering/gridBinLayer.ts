import { color, Layer, picking, project32 } from '@deck.gl/core'
import type {
  Accessor,
  Color,
  DefaultProps,
  LayerDataSource,
  LayerProps,
  Position,
  UpdateParameters,
} from '@deck.gl/core'
import { Geometry, Model } from '@luma.gl/engine'

// Draws grid bins (Visium HD squares, or any parallelograms) as one instanced
// quad each: a centre plus the two edge vectors. Every bin is uploaded once,
// so panning only moves the camera, and the outline is drawn in the fragment
// shader instead of as a separate path layer.

const uniformBlock = /* glsl */ `\
layout(std140) uniform gridBinUniforms {
  float lineWidthPixels;
  float stroked;
  float filled;
} gridBin;
`

const gridBinUniforms = {
  name: 'gridBin',
  vs: uniformBlock,
  fs: uniformBlock,
  uniformTypes: {
    lineWidthPixels: 'f32',
    stroked: 'f32',
    filled: 'f32',
  },
} as const

const vs = /* glsl */ `\
#version 300 es
#define SHADER_NAME grid-bin-layer-vertex-shader

in vec3 positions;
in vec3 instanceCenters;
in vec3 instanceCenters64Low;
in vec2 instanceColumnVectors;
in vec2 instanceRowVectors;
in vec4 instanceFillColors;
in vec4 instanceLineColors;
in vec3 instancePickingColors;

out vec4 vFillColor;
out vec4 vLineColor;
out vec2 vUnit;
out float vLineWidthDevicePixels;

void main(void) {
  vec2 offset = positions.x * instanceColumnVectors + positions.y * instanceRowVectors;
  vec3 corner = instanceCenters + vec3(offset, 0.0);

  geometry.worldPosition = corner;
  geometry.uv = positions.xy;
  geometry.pickingColor = instancePickingColors;
  vUnit = positions.xy + 0.5;
  vLineWidthDevicePixels = gridBin.lineWidthPixels * project.devicePixelRatio;

  gl_Position = project_position_to_clipspace(
    corner,
    instanceCenters64Low,
    vec3(0.0),
    geometry.position
  );
  DECKGL_FILTER_GL_POSITION(gl_Position, geometry);

  vFillColor = vec4(instanceFillColors.rgb, instanceFillColors.a * layer.opacity);
  DECKGL_FILTER_COLOR(vFillColor, geometry);
  vLineColor = vec4(instanceLineColors.rgb, instanceLineColors.a * layer.opacity);
  DECKGL_FILTER_COLOR(vLineColor, geometry);
}
`

const fs = /* glsl */ `\
#version 300 es
#define SHADER_NAME grid-bin-layer-fragment-shader

precision highp float;

in vec4 vFillColor;
in vec4 vLineColor;
in vec2 vUnit;
in float vLineWidthDevicePixels;

out vec4 fragColor;

// Device pixels from this fragment to the nearer of the two edges across one
// axis of the bin.
float edgeDistancePixels(float unit) {
  float unitsPerPixel = length(vec2(dFdx(unit), dFdy(unit)));
  return min(unit, 1.0 - unit) / max(unitsPerPixel, 1e-6);
}

void main(void) {
  geometry.uv = vUnit - 0.5;

  // Neighbouring bins share edges and each draws the inner half of the line.
  float distanceToEdge = min(edgeDistancePixels(vUnit.x), edgeDistancePixels(vUnit.y));
  float isLine = gridBin.stroked *
    clamp(vLineWidthDevicePixels * 0.5 - distanceToEdge + 0.5, 0.0, 1.0);

  if (gridBin.filled > 0.5) {
    fragColor = mix(vFillColor, vLineColor, isLine);
  } else {
    if (isLine == 0.0) {
      discard;
    }
    fragColor = vec4(vLineColor.rgb, vLineColor.a * isLine);
  }

  DECKGL_FILTER_COLOR(fragColor, geometry);
}
`

type GridBinVector = readonly [number, number]

interface GridBinLayerOwnProps<DataT> {
  readonly data: LayerDataSource<DataT>
  // Bin centre and the vectors from one corner to its column and row
  // neighbours, in world units.
  readonly getCenter?: Accessor<DataT, Position>
  readonly getColumnVector?: Accessor<DataT, GridBinVector>
  readonly getRowVector?: Accessor<DataT, GridBinVector>
  readonly getFillColor?: Accessor<DataT, Color>
  readonly getLineColor?: Accessor<DataT, Color>
  readonly lineWidthPixels?: number
  readonly stroked?: boolean
  readonly filled?: boolean
}

export type GridBinLayerProps<DataT> = GridBinLayerOwnProps<DataT> & LayerProps

const defaultProps: DefaultProps<GridBinLayerOwnProps<unknown>> = {
  getCenter: { type: 'accessor', value: [0, 0, 0] },
  getColumnVector: { type: 'accessor', value: [1, 0] },
  getRowVector: { type: 'accessor', value: [0, 1] },
  getFillColor: { type: 'accessor', value: [0, 0, 0, 255] },
  getLineColor: { type: 'accessor', value: [0, 0, 0, 255] },
  lineWidthPixels: { type: 'number', min: 0, value: 1 },
  stroked: true,
  filled: true,
}

// Corners of the unit quad, as a triangle strip.
const QUAD_POSITIONS = new Float32Array([
  -0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0,
])

export class GridBinLayer<DataT = unknown> extends Layer<
  Required<GridBinLayerOwnProps<DataT>> & LayerProps
> {
  static override layerName = 'GridBinLayer'
  static override defaultProps = defaultProps

  declare state: {
    model?: Model
  }

  override getShaders() {
    return super.getShaders({
      vs,
      fs,
      modules: [project32, color, picking, gridBinUniforms],
    })
  }

  override initializeState() {
    this.getAttributeManager()?.addInstanced({
      instanceCenters: {
        size: 3,
        type: 'float64',
        fp64: this.use64bitPositions(),
        accessor: 'getCenter',
      },
      instanceColumnVectors: {
        size: 2,
        accessor: 'getColumnVector',
      },
      instanceRowVectors: {
        size: 2,
        accessor: 'getRowVector',
      },
      instanceFillColors: {
        size: 4,
        type: 'unorm8',
        accessor: 'getFillColor',
        defaultValue: [0, 0, 0, 255],
      },
      instanceLineColors: {
        size: 4,
        type: 'unorm8',
        accessor: 'getLineColor',
        defaultValue: [0, 0, 0, 255],
      },
    })
  }

  override updateState(params: UpdateParameters<this>) {
    super.updateState(params)

    if (params.changeFlags.extensionsChanged || this.state.model === undefined) {
      this.state.model?.destroy()
      this.state.model = this.createModel()
      this.getAttributeManager()?.invalidateAll()
    }
  }

  override draw() {
    const model = this.state.model

    if (model === undefined) {
      return
    }

    model.shaderInputs.setProps({
      gridBin: {
        lineWidthPixels: this.props.lineWidthPixels,
        stroked: this.props.stroked ? 1 : 0,
        filled: this.props.filled ? 1 : 0,
      },
    })
    model.draw(this.context.renderPass)
  }

  private createModel(): Model {
    return new Model(this.context.device, {
      ...this.getShaders(),
      id: this.props.id,
      bufferLayout: this.getAttributeManager()?.getBufferLayouts() ?? [],
      geometry: new Geometry({
        topology: 'triangle-strip',
        attributes: {
          positions: { size: 3, value: QUAD_POSITIONS },
        },
      }),
      isInstanced: true,
    })
  }
}
