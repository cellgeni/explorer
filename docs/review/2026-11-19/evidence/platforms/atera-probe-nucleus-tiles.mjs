// Which level-0 nucleus tiles hold each cell's nuclei (reference run).
import { ZipFileStore } from '@zarrita/storage'
import * as zarr from 'zarrita'
const B =
  'https://mp33.cog.sanger.ac.uk/public/test/50170325_WSI_KID_04_region1/50170325_WSI_KID_04_region1'
const store = ZipFileStore.fromUrl(`${B}/cells.zarr.zip`)
const root = zarr.root(store)
for (const set of [0, 1]) {
  const group = await zarr.open.v2(root.resolve(`gridded_polygon_sets/${set}`), {
    kind: 'group',
  })
  const levels = group.attrs.grid_keys
  for (const level of [0, 4]) {
    const keys = levels[level].map((k) => (Array.isArray(k) ? k.join(',') : k))
    const tilesByCell = new Map()
    const perTileDup = { cells: 0, polys: 0 }
    let polys = 0
    const queue = [...keys]
    await Promise.all(
      Array.from({ length: 12 }, async () => {
        while (queue.length) {
          const key = queue.shift()
          const arr = await zarr.open.v2(
            root.resolve(`gridded_polygon_sets/${set}/${level}/${key}/cell_index`),
            { kind: 'array' },
          )
          const { data } = await zarr.get(arr, [null])
          const seen = new Map()
          for (const c of data) {
            polys += 1
            seen.set(c, (seen.get(c) ?? 0) + 1)
            const s = tilesByCell.get(c) ?? new Set()
            s.add(key)
            tilesByCell.set(c, s)
          }
          for (const v of seen.values())
            if (v > 1) {
              perTileDup.cells += 1
              perTileDup.polys += v
            }
        }
      }),
    )
    let multiTile = 0
    const examples = []
    for (const [c, s] of tilesByCell)
      if (s.size > 1) {
        multiTile += 1
        if (examples.length < 5) examples.push([c, [...s]])
      }
    console.log(
      JSON.stringify({
        set,
        level,
        tiles: keys.length,
        polygons: polys,
        distinctCells: tilesByCell.size,
        cellsInSeveralTiles: multiTile,
        cellsWithSeveralPolygonsInOneTile: perTileDup.cells,
        examples,
      }),
    )
  }
}
