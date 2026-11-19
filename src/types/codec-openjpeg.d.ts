declare module '@cornerstonejs/codec-openjpeg/decodewasmjs' {
  export interface OpenJpegFrameInfo {
    readonly width: number
    readonly height: number
    readonly bitsAllocated?: number
    readonly componentCount?: number
  }

  export interface J2KDecoder {
    getEncodedBuffer(length: number): Uint8Array
    decode(): void
    getFrameInfo(): OpenJpegFrameInfo
    getDecodedBuffer(): Uint8Array
    delete?(): void
  }

  export interface OpenJpegModule {
    readonly J2KDecoder: new () => J2KDecoder
  }

  export interface OpenJpegModuleOptions {
    // Emscripten's hook for finding the .wasm; scriptDirectory is the glue's
    // own directory (a file path under Node).
    readonly locateFile?: (path: string, scriptDirectory: string) => string
  }

  export default function createOpenJpegModule(
    options?: OpenJpegModuleOptions,
  ): Promise<OpenJpegModule>
}
