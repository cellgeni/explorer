const NON_GENE_PATTERNS = [
  /^Total transcripts$/i,
  /NegControlProbe/i,
  /NegControlCodeword/i,
  /^BLANK/i,
  /UnassignedCodeword/i,
  /antisense/i,
  /Deprecated/i,
] as const

export function isGeneFeature(name: string, featureType?: string): boolean {
  if (NON_GENE_PATTERNS.some((pattern) => pattern.test(name))) {
    return false
  }

  if (featureType === undefined) {
    return true
  }

  const normalizedType = featureType.trim().toLowerCase()
  return normalizedType === 'gene' || normalizedType === 'gene expression'
}

export function createGeneFeatureIndex(
  geneNames: readonly string[],
  featureTypes: readonly string[],
): ReadonlySet<number> {
  const indices = new Set<number>()

  for (let index = 0; index < geneNames.length; index += 1) {
    const geneName = geneNames[index]

    if (geneName !== undefined && isGeneFeature(geneName, featureTypes[index])) {
      indices.add(index)
    }
  }

  return indices
}
