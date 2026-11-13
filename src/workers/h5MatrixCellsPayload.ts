import type { GexCell, GexResult } from '../data/gexTypes'
import type { H5MatrixCellsPayload } from './h5FileMessages'

export function packGexResult(result: GexResult<string>): H5MatrixCellsPayload {
  const names: string[] = []
  const nameIndexByName = new Map<string, number>()
  const ids: string[] = []
  let countTotal = 0

  for (const cell of result.cells.values()) {
    countTotal += cell.counts.length
  }

  const offsets = new Uint32Array(result.cells.size + 1)
  const nameIndices = new Uint32Array(countTotal)
  const counts = new Float64Array(countTotal)
  let cursor = 0

  for (const [id, cell] of result.cells) {
    offsets[ids.length] = cursor
    ids.push(id)

    for (let index = 0; index < cell.counts.length; index += 1) {
      const name = cell.geneNames[index] ?? ''
      let nameIndex = nameIndexByName.get(name)

      if (nameIndex === undefined) {
        nameIndex = names.length
        names.push(name)
        nameIndexByName.set(name, nameIndex)
      }

      nameIndices[cursor] = nameIndex
      counts[cursor] = cell.counts[index] ?? 0
      cursor += 1
    }
  }

  offsets[ids.length] = cursor

  return { geneNames: [...result.geneNames], names, ids, offsets, nameIndices, counts }
}

export function unpackGexResult<ElementId extends string>(
  payload: H5MatrixCellsPayload,
): GexResult<ElementId> {
  const cells = new Map<ElementId, GexCell>()

  for (let cell = 0; cell < payload.ids.length; cell += 1) {
    const start = payload.offsets[cell] ?? 0
    const end = payload.offsets[cell + 1] ?? start
    const geneNames: string[] = []
    const counts: number[] = []

    for (let cursor = start; cursor < end; cursor += 1) {
      geneNames.push(payload.names[payload.nameIndices[cursor] ?? 0] ?? '')
      counts.push(payload.counts[cursor] ?? 0)
    }

    cells.set(payload.ids[cell] as ElementId, { geneNames, counts })
  }

  return { geneNames: [...payload.geneNames], cells }
}

export function gexPayloadTransferables(payload: H5MatrixCellsPayload): Transferable[] {
  return [payload.offsets.buffer, payload.nameIndices.buffer, payload.counts.buffer]
}
