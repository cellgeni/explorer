// The URL of a file in a folder given by its URL. The path goes into the URL's
// path, before any query, which is kept: a host that grants a folder by query,
// such as an Azure SAS token, wants it on every file. The fragment names a
// view, not the folder, and is dropped. With an empty path, the folder with a
// trailing slash.
export function folderFileUrl(folderUrl: string, path: string): string {
  const { folder, query } = splitFolderUrl(folderUrl)
  return `${folder}${path.replace(/^\/+/, '')}${query}`
}

// The path `folderFileUrl` put in `url`, or undefined for a URL outside the
// folder.
export function pathInFolder(folderUrl: string, url: string): string | undefined {
  const { folder, query } = splitFolderUrl(folderUrl)
  return url.startsWith(folder) && url.endsWith(query)
    ? url.slice(folder.length, url.length - query.length)
    : undefined
}

// The folder with one trailing slash, and its query with its `?`.
function splitFolderUrl(folderUrl: string): { folder: string; query: string } {
  const hash = folderUrl.indexOf('#')
  const withoutHash = hash === -1 ? folderUrl : folderUrl.slice(0, hash)
  const queryStart = withoutHash.indexOf('?')
  const folder = queryStart === -1 ? withoutHash : withoutHash.slice(0, queryStart)

  return {
    folder: `${folder.replace(/\/+$/, '')}/`,
    query: queryStart === -1 ? '' : withoutHash.slice(queryStart),
  }
}
