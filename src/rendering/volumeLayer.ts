import { Layer, project32 } from '@deck.gl/core'
import type {
  DefaultProps,
  LayerContext,
  LayerProps,
  UpdateParameters,
} from '@deck.gl/core'
import { Geometry, Model } from '@luma.gl/engine'
import { MAX_VOLUME_CHANNELS, type VolumeTextureData } from '../data/imageVolume'

// Draws a z-stack in 3D by marching rays through one 3D texture per channel
// (plan: 3D view). The volume is a box centred on the origin: x and z grow
// with the image's columns and planes, and y falls as its rows go down, so a
// view from +z looks like the 2D view. The box's back faces are drawn, so the
// rays also work with the camera inside it.

export type VolumeRenderMode = 'mip' | 'translucent'

export interface VolumeLayerChannel {
  readonly texture: VolumeTextureData
  readonly color: readonly [number, number, number]
  // The contrast window in raw values.
  readonly contrastMin: number
  readonly contrastMax: number
}

interface VolumeLayerOwnProps {
  // Up to MAX_VOLUME_CHANNELS channels of the same shape.
  readonly channels: readonly VolumeLayerChannel[]
  // The box's size along x, y and z, in world units.
  readonly extent: readonly [number, number, number]
  readonly renderMode: VolumeRenderMode
  // How opaque translucent rendering is, 0 to 1: at 0 a ray must cross the
  // whole volume at full intensity to be mostly hidden, at 1 one voxel.
  readonly density: number
}

export type VolumeLayerProps = VolumeLayerOwnProps & LayerProps

type VolumeTexture = ReturnType<LayerContext['device']['createTexture']>

const CHANNEL_INDICES = Array.from(
  { length: MAX_VOLUME_CHANNELS },
  (_value, index) => index,
)

const uniformTypes = {
  extent: 'vec3<f32>',
  dimensions: 'vec3<f32>',
  channelCount: 'f32',
  translucent: 'f32',
  opacityPerVoxel: 'f32',
  ...Object.fromEntries(
    CHANNEL_INDICES.flatMap((index) => [
      [`color${index}`, 'vec3<f32>'],
      [`window${index}`, 'vec2<f32>'],
    ]),
  ),
} as const

const GLSL_TYPES: Readonly<Record<string, string>> = {
  f32: 'float',
  'vec2<f32>': 'vec2',
  'vec3<f32>': 'vec3',
}

const uniformBlock = /* glsl */ `\
layout(std140) uniform volumeUniforms {
${Object.entries(uniformTypes)
  .map(([name, type]) => `  ${GLSL_TYPES[type] ?? 'float'} ${name};`)
  .join('\n')}
} volume;
`

const volumeUniforms = {
  name: 'volume',
  vs: uniformBlock,
  fs: uniformBlock,
  uniformTypes,
} as const

const vs = /* glsl */ `\
#version 300 es
#define SHADER_NAME volume-layer-vertex-shader

in vec3 positions;

out vec3 vTexturePosition;
out vec3 vCameraTexturePosition;

void main(void) {
  vec3 worldScale = volume.extent * vec3(1.0, -1.0, 1.0);
  vec3 world = (positions - 0.5) * worldScale;

  geometry.worldPosition = world;
  gl_Position = project_position_to_clipspace(world, vec3(0.0), vec3(0.0), geometry.position);

  // The camera in texture coordinates: common space is world space scaled
  // and shifted, so the offset from this corner maps back linearly.
  vTexturePosition = positions;
  vCameraTexturePosition = positions +
    (project.cameraPosition - geometry.position.xyz) /
    (worldScale * project.commonUnitsPerWorldUnit);
}
`

const sampleChannels = (body: (index: number) => string) =>
  CHANNEL_INDICES.map(
    (index) => `    if (volume.channelCount > ${index}.5) {
      float value = windowed(texture(volume${index}, position).r, volume.window${index});
${body(index)}
    }`,
  ).join('\n')

const fs = /* glsl */ `\
#version 300 es
#define SHADER_NAME volume-layer-fragment-shader

precision highp float;
precision highp sampler3D;

${CHANNEL_INDICES.map((index) => `uniform sampler3D volume${index};`).join('\n')}

in vec3 vTexturePosition;
in vec3 vCameraTexturePosition;

out vec4 fragColor;

const int MAX_STEPS = 1024;

float windowed(float value, vec2 window) {
  return clamp((value - window.x) / max(window.y - window.x, 1e-6), 0.0, 1.0);
}

void main(void) {
  vec3 direction = normalize(vTexturePosition - vCameraTexturePosition);
  vec3 inverseDirection = 1.0 / direction;
  vec3 near = (vec3(0.0) - vCameraTexturePosition) * inverseDirection;
  vec3 far = (vec3(1.0) - vCameraTexturePosition) * inverseDirection;
  vec3 entries = min(near, far);
  vec3 exits = max(near, far);
  float tStart = max(max(max(entries.x, entries.y), entries.z), 0.0);
  float tEnd = min(min(exits.x, exits.y), exits.z);

  if (tEnd <= tStart) {
    discard;
  }

  vec3 start = vCameraTexturePosition + direction * tStart;
  vec3 end = vCameraTexturePosition + direction * tEnd;
  // About one sample per voxel the ray crosses.
  float voxels = length((end - start) * volume.dimensions);
  int steps = int(clamp(ceil(voxels), 1.0, float(MAX_STEPS)));
  vec3 stepVector = (end - start) / float(steps);
  float voxelsPerStep = voxels / float(steps);
  // Starting each ray at a different fraction of a step hides banding.
  float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  vec3 position = start + stepVector * jitter;

  vec3 peaks0 = vec3(0.0);
  vec3 peaks1 = vec3(0.0);
  vec4 accumulated = vec4(0.0);

  for (int index = 0; index < MAX_STEPS; index += 1) {
    if (index >= steps) {
      break;
    }

    vec3 sampleColor = vec3(0.0);
    float sampleValue = 0.0;

${sampleChannels((index) => {
  const peak = `peaks${Math.floor(index / 3)}.${'xyz'[index % 3] ?? 'x'}`
  return `      ${peak} = max(${peak}, value);
      sampleColor += volume.color${index} * value;
      sampleValue = max(sampleValue, value);`
})}

    if (volume.translucent > 0.5 && sampleValue > 0.0) {
      // Front to back. Opacity grows with the square of intensity, so faint
      // background does not fog the volume.
      float voxelAlpha = min(sampleValue * sampleValue * volume.opacityPerVoxel, 0.999);
      float alpha = 1.0 - pow(1.0 - voxelAlpha, voxelsPerStep);
      vec3 color = min(sampleColor / sampleValue, vec3(1.0));
      accumulated += (1.0 - accumulated.a) * vec4(color * alpha, alpha);

      if (accumulated.a > 0.98) {
        break;
      }
    }

    position += stepVector;
  }

  if (volume.translucent > 0.5) {
    fragColor = vec4(accumulated.rgb, 1.0);
  } else {
    // Maximum intensity of each channel along the ray, added like the 2D view.
    vec3 color = vec3(0.0);
${CHANNEL_INDICES.map(
  (index) =>
    `    color += volume.color${index} * peaks${Math.floor(index / 3)}.${'xyz'[index % 3] ?? 'x'};`,
).join('\n')}
    fragColor = vec4(min(color, vec3(1.0)), 1.0);
  }
}
`

// The unit cube's twelve triangles, wound outwards.
const CUBE_POSITIONS = new Float32Array(
  [
    // -x, +x
    [0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 1, 0],
    [1, 0, 0, 1, 1, 1, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 1, 1],
    // -y, +y
    [0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1],
    [0, 1, 0, 0, 1, 1, 1, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1, 0],
    // -z, +z
    [0, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 1, 0, 0],
    [0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 0, 1, 1],
  ].flat(),
)

const defaultProps: DefaultProps<VolumeLayerOwnProps> = {
  channels: { type: 'array', value: [], compare: true },
  extent: { type: 'array', value: [1, 1, 1], compare: true },
  renderMode: 'mip',
  density: { type: 'number', min: 0, max: 1, value: 0.5 },
}

export class VolumeLayer extends Layer<Required<VolumeLayerOwnProps> & LayerProps> {
  static override layerName = 'VolumeLayer'
  static override defaultProps = defaultProps

  declare state: {
    model?: Model
    // By the data they hold, so a contrast or colour change keeps them.
    textures: Map<VolumeTextureData, VolumeTexture>
    emptyTexture?: VolumeTexture
  }

  override getShaders() {
    return super.getShaders({ vs, fs, modules: [project32, volumeUniforms] })
  }

  override initializeState() {
    this.state = { textures: new Map() }
  }

  override updateState(params: UpdateParameters<this>) {
    super.updateState(params)

    if (params.changeFlags.extensionsChanged || this.state.model === undefined) {
      this.state.model?.destroy()
      this.state.model = this.createModel()
    }

    if (params.changeFlags.propsChanged) {
      this.updateTextures()
    }
  }

  override finalizeState(context: LayerContext) {
    super.finalizeState(context)

    for (const texture of this.state.textures.values()) {
      texture.destroy()
    }

    this.state.textures.clear()
    this.state.emptyTexture?.destroy()
    this.state.model?.destroy()
  }

  override draw() {
    const { model, textures } = this.state
    const channels = this.props.channels.slice(0, MAX_VOLUME_CHANNELS)
    const first = channels[0]?.texture

    if (model === undefined || first === undefined) {
      return
    }

    const emptyTexture = this.emptyTexture()

    model.setBindings(
      Object.fromEntries(
        CHANNEL_INDICES.map((index) => {
          const data = channels[index]?.texture
          return [
            `volume${index}`,
            (data === undefined ? undefined : textures.get(data)) ?? emptyTexture,
          ]
        }),
      ),
    )
    model.shaderInputs.setProps({
      volume: {
        extent: this.props.extent,
        dimensions: [first.width, first.height, first.depth],
        channelCount: channels.length,
        translucent: this.props.renderMode === 'translucent' ? 1 : 0,
        // A full-intensity voxel's opacity: 1 / longest side at density 0,
        // 1 at density 1, and 1 / its square root by default.
        opacityPerVoxel:
          Math.max(first.width, first.height, first.depth) ** (this.props.density - 1),
        ...Object.fromEntries(
          CHANNEL_INDICES.flatMap((index) => {
            const channel = channels[index]
            const scale = channel?.texture.scale ?? 1

            return [
              [
                `color${index}`,
                channel === undefined
                  ? [0, 0, 0]
                  : channel.color.map((component) => component / 255),
              ],
              [
                `window${index}`,
                channel === undefined
                  ? [0, 1]
                  : [channel.contrastMin / scale, channel.contrastMax / scale],
              ],
            ]
          }),
        ),
      },
    })
    model.draw(this.context.renderPass)
  }

  private updateTextures() {
    const { textures } = this.state
    const wanted = new Set(
      this.props.channels.slice(0, MAX_VOLUME_CHANNELS).map((channel) => channel.texture),
    )

    for (const [data, texture] of textures) {
      if (!wanted.has(data)) {
        texture.destroy()
        textures.delete(data)
      }
    }

    for (const data of wanted) {
      if (!textures.has(data)) {
        textures.set(data, this.createVolumeTexture(data))
      }
    }
  }

  private createVolumeTexture(data: VolumeTextureData): VolumeTexture {
    const texture = this.context.device.createTexture({
      id: `${this.props.id}-volume`,
      dimension: '3d',
      format: data.format,
      width: data.width,
      height: data.height,
      depth: data.depth,
      mipLevels: 1,
      sampler: {
        minFilter: 'linear',
        magFilter: 'linear',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
        addressModeW: 'clamp-to-edge',
      },
    })

    texture.writeData(data.data)
    return texture
  }

  // Bound to the samplers of absent channels, which are never read.
  private emptyTexture(): VolumeTexture {
    this.state.emptyTexture ??= this.createVolumeTexture({
      data: new Uint8Array(1),
      format: 'r8unorm',
      width: 1,
      height: 1,
      depth: 1,
      scale: 255,
    })
    return this.state.emptyTexture
  }

  private createModel(): Model {
    return new Model(this.context.device, {
      ...this.getShaders(),
      id: this.props.id,
      bufferLayout: [],
      geometry: new Geometry({
        topology: 'triangle-list',
        attributes: {
          positions: { size: 3, value: CUBE_POSITIONS },
        },
      }),
      vertexCount: CUBE_POSITIONS.length / 3,
      parameters: {
        // Flipping y mirrors the cube, so its outward faces wind clockwise.
        frontFace: 'cw',
        cullMode: 'front',
        depthWriteEnabled: false,
        depthCompare: 'always',
      },
    })
  }
}
