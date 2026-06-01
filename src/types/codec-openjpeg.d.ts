declare module '@cornerstonejs/codec-openjpeg' {
  export interface OpenJpegFrameInfo {
    readonly width: number
    readonly height: number
    readonly bitsAllocated?: number
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

  export default function createOpenJpegModule(): Promise<OpenJpegModule>
}
