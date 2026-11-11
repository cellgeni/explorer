import { useEffect, useMemo, useRef, useState } from 'react'
import type { GeneSelectionModel } from '../sections/cellsSectionModel'
import {
  defaultGeneSetName,
  filterGeneOptions,
  parseGeneSetSymbols,
  type SavedGeneSet,
} from './geneControlsModel'

// The gene picker's own state: the search, the typed symbols, the set name
// and the saved sets. It stays in the picker, so typing does not re-render
// the app, and it resets when a new gene panel starts loading.
export function useGeneSetControls(genes: GeneSelectionModel) {
  const { log, onApply, onToggle, options, panelState, scoreMode, selected } = genes
  const [geneSearch, setGeneSearch] = useState('')
  const [geneSetSymbols, setGeneSetSymbols] = useState('')
  const [geneSetName, setGeneSetName] = useState('')
  const [savedGeneSets, setSavedGeneSets] = useState<readonly SavedGeneSet[]>([])
  const geneSetIdRef = useRef(0)
  const lastGenePanelLoadingUrlRef = useRef<string | null>(null)

  useEffect(() => {
    if (
      panelState.status !== 'loading' ||
      panelState.url === lastGenePanelLoadingUrlRef.current
    ) {
      return
    }

    lastGenePanelLoadingUrlRef.current = panelState.url
    geneSetIdRef.current = 0
    setGeneSearch('')
    setGeneSetSymbols('')
    setGeneSetName('')
    setSavedGeneSets([])
  }, [panelState])

  const aliases = panelState.status === 'ready' ? panelState.aliases : undefined
  const filteredGenes = useMemo(
    () => filterGeneOptions(options, geneSearch, selected, { aliases }),
    [aliases, options, geneSearch, selected],
  )

  return {
    aliases,
    filteredGenes,
    geneSearch,
    geneSetName,
    geneSetSymbols,
    savedGeneSets,
    setGeneSearch,
    setGeneSetName,
    setGeneSetSymbols,
    // Adds a gene from the search list, which also clears the search.
    pickGene: (gene: string) => {
      onToggle(gene)
      setGeneSearch('')
    },
    applyGeneSetSymbols: () => {
      const parsed = parseGeneSetSymbols(geneSetSymbols, options, aliases)

      if (parsed.length === 0) {
        return
      }

      log(`Applied symbols: ${parsed.length.toLocaleString()} genes`)
      onApply(parsed)
      setGeneSearch('')
    },
    saveSelectedGeneSet: () => {
      if (selected.length === 0) {
        return
      }

      const name = geneSetName.trim() || defaultGeneSetName(selected)
      const normalizedName = name.toLowerCase()
      const savedSet: SavedGeneSet = {
        id: `gene-set-${geneSetIdRef.current + 1}`,
        name,
        genes: selected,
        scoreMode,
      }

      geneSetIdRef.current += 1
      log(`Saved gene set ${name}`)
      setSavedGeneSets((current) => [
        savedSet,
        ...current.filter((geneSet) => geneSet.name.toLowerCase() !== normalizedName),
      ])
      setGeneSetName('')
    },
    applySavedGeneSet: (geneSet: SavedGeneSet) => {
      log(`Applied gene set ${geneSet.name}`)
      onApply(geneSet.genes, geneSet.scoreMode)
      setGeneSearch('')
    },
    removeSavedGeneSet: (id: string) => {
      const removedSet = savedGeneSets.find((geneSet) => geneSet.id === id)

      if (removedSet !== undefined) {
        log(`Removed gene set ${removedSet.name}`)
      }

      setSavedGeneSets((current) => current.filter((geneSet) => geneSet.id !== id))
    },
  }
}
