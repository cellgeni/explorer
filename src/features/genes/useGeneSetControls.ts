import { useEffect, useMemo, useRef, useState } from 'react'
import type { GeneSelectionModel } from '../sections/cellsSectionModel'
import {
  filterGeneOptions,
  geneSetSymbolsNotice,
  matchGeneSetSymbols,
  savedGeneSetId,
  unnamedGeneSetName,
  withGeneSetAt,
  type SavedGeneSet,
} from './geneControlsModel'

// The gene picker's own state: the search, the typed symbols and the set
// name. It stays in the picker, so typing does not re-render the app, and it
// resets when a new gene panel starts loading. The saved sets are the app's,
// so the link keeps them.
export function useGeneSetControls(genes: GeneSelectionModel) {
  const {
    log,
    onApply,
    onOfferUndo,
    onSavedSetsChange: setSavedGeneSets,
    onToggle,
    options,
    panelState,
    savedSets: savedGeneSets,
    scoreMode,
    selected,
  } = genes
  const [geneSearch, setGeneSearch] = useState('')
  const [geneSetSymbols, setTypedGeneSetSymbols] = useState('')
  // Which applied symbols matched no gene, until the symbols change.
  const [geneSetSymbolsMessage, setGeneSetSymbolsMessage] = useState<string | null>(null)
  const [geneSetName, setGeneSetName] = useState('')
  const lastGenePanelLoadingUrlRef = useRef<string | null>(null)

  useEffect(() => {
    if (
      panelState.status !== 'loading' ||
      panelState.url === lastGenePanelLoadingUrlRef.current
    ) {
      return
    }

    lastGenePanelLoadingUrlRef.current = panelState.url
    setGeneSearch('')
    setTypedGeneSetSymbols('')
    setGeneSetSymbolsMessage(null)
    setGeneSetName('')
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
    geneSetSymbolsMessage,
    // Save Set's name for the selection when none is typed.
    unnamedSetName: unnamedGeneSetName(selected, savedGeneSets),
    savedGeneSets,
    setGeneSearch,
    setGeneSetName,
    setGeneSetSymbols: (value: string) => {
      setTypedGeneSetSymbols(value)
      setGeneSetSymbolsMessage(null)
    },
    // Adds a gene from the search list, which also clears the search.
    pickGene: (gene: string) => {
      onToggle(gene)
      setGeneSearch('')
    },
    // Symbols that match no gene are named under the button; with none
    // matching, the selection stays.
    applyGeneSetSymbols: () => {
      const match = matchGeneSetSymbols(geneSetSymbols, options, aliases)

      setGeneSetSymbolsMessage(geneSetSymbolsNotice(match))
      if (match.genes.length === 0) {
        log(`Applied symbols: none of ${match.unmatched.length.toLocaleString()} matched`)
        return
      }

      log(
        `Applied symbols: ${match.genes.length.toLocaleString()} genes, ${match.unmatched.length.toLocaleString()} unmatched`,
      )
      onApply(match.genes)
      setGeneSearch('')
    },
    saveSelectedGeneSet: () => {
      if (selected.length === 0) {
        return
      }

      // Unnamed, it does not replace a saved set of other genes.
      const name = geneSetName.trim() || unnamedGeneSetName(selected, savedGeneSets)
      const savedSet: SavedGeneSet = {
        id: savedGeneSetId(name),
        name,
        genes: selected,
        scoreMode,
      }

      log(`Saved gene set ${name}`)
      setSavedGeneSets((current) => [
        savedSet,
        ...current.filter((geneSet) => geneSet.id !== savedSet.id),
      ])
      setGeneSetName('')
    },
    applySavedGeneSet: (geneSet: SavedGeneSet) => {
      log(`Applied gene set ${geneSet.name}`)
      onApply(geneSet.genes, geneSet.scoreMode)
      setGeneSearch('')
    },
    // Adds the set's genes to the selection, sorted as picked genes are, and
    // keeps the score mode, so several sets show at once (as Point color's
    // Gene set colours them).
    addSavedGeneSet: (geneSet: SavedGeneSet) => {
      const current = new Set(selected)
      const added = geneSet.genes.filter((gene) => !current.has(gene))

      if (added.length === 0) {
        return
      }

      log(
        `Added gene set ${geneSet.name}: ${added.length.toLocaleString()} ${
          added.length === 1 ? 'gene' : 'genes'
        }`,
      )
      onApply([...selected, ...added].sort((a, b) => a.localeCompare(b)))
      setGeneSearch('')
    },
    // Offers Undo, which puts the set back where it was (15.3-C).
    removeSavedGeneSet: (id: string) => {
      const index = savedGeneSets.findIndex((geneSet) => geneSet.id === id)
      const removedSet = savedGeneSets[index]

      setSavedGeneSets((current) => current.filter((geneSet) => geneSet.id !== id))
      if (removedSet === undefined) return

      log(`Removed gene set ${removedSet.name}`)
      onOfferUndo({
        message: `Removed gene set ${removedSet.name}`,
        undo: () => {
          setSavedGeneSets((current) => withGeneSetAt(current, removedSet, index))
          log(`Restored gene set ${removedSet.name}`)
        },
      })
    },
  }
}
