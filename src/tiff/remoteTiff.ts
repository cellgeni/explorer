import { fromCustomClient } from 'geotiff'
import type {
  BaseClient,
  BaseResponse,
  BlockedSourceOptions,
  GeoTIFF,
  RemoteSourceOptions,
} from 'geotiff'
import { byteRangeFileVersion, responseValidator } from '../data/persistentByteRangeCache'

// The version of each file opened by openRemoteTiff (see
// byteRangeFileVersion), which its tiles are cached under.
const remoteTiffVersions = new WeakMap<GeoTIFF, string>()

// Opens a TIFF over HTTP Range requests, as geotiff's fromUrl does, and keeps
// the file's size and validator from the first response, the header read, so
// its tiles can be cached by version without a request of their own. geotiff
// hands the block options to its BlockedSource, though its type leaves them
// out.
export async function openRemoteTiff(
  url: string,
  options: RemoteSourceOptions & BlockedSourceOptions,
): Promise<GeoTIFF> {
  const client = new VersionedFetchClient(url)
  const tiff = await fromCustomClient(client, options)

  remoteTiffVersions.set(tiff, client.version ?? '')
  return tiff
}

// Empty for a file opened another way, such as from memory.
export function remoteTiffVersion(tiff: GeoTIFF): string {
  return remoteTiffVersions.get(tiff) ?? ''
}

// geotiff's fetch client, without credentials. It implements geotiff's
// client rather than extending it, so tests that mock geotiff can load it.
class VersionedFetchClient implements BaseClient {
  version: string | undefined

  constructor(readonly url: string) {}

  async request(options: RequestInit = {}): Promise<BaseResponse> {
    const response = await fetch(this.url, options)

    if (this.version === undefined && response.status === 206) {
      this.version = byteRangeFileVersion(
        contentRangeTotal(response.headers),
        responseValidator(response.headers),
      )
    }

    return new FetchResponse(response)
  }
}

class FetchResponse implements BaseResponse {
  constructor(private readonly response: Response) {}

  get ok(): boolean {
    return this.response.ok
  }

  get status(): number {
    return this.response.status
  }

  getHeader(name: string): string | undefined {
    return this.response.headers.get(name) ?? undefined
  }

  getData(): Promise<ArrayBuffer> {
    return this.response.arrayBuffer()
  }
}

// The file size a 206 response gives after the slash in Content-Range;
// undefined when it is `*` or CORS hides the header.
function contentRangeTotal(headers: Headers): number | undefined {
  const match = /\/(\d+)\s*$/.exec(headers.get('content-range') ?? '')
  return match === null ? undefined : Number(match[1])
}
