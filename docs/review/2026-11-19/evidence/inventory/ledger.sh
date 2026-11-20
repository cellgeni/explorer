#!/bin/sh
# Builds ledger.tsv (kind, path, lines, area, stage, depth) from tracked-files.tsv and the
# line counts in source-areas.tsv. Areas follow section 2 of the review plan.
cd "$(dirname "$0")"
awk -F'\t' '
FNR==NR { lines[$3]=$2; next }
{
  kind=$1; p=$2; a=""; s=""
  if (kind=="source") {
    if (p ~ /^src\/datasets\/(spatialDataset|datasetFactory|datasetManifest|datasetCollection|datasetDetectionError|datasetCache)\.ts$/) { a="contracts-detection"; s="2,4" }
    else if (p ~ /^src\/(App\.tsx|main\.tsx|store\/)/ || p ~ /^src\/features\/app-shell\//) { a="loading-state"; s="5,7" }
    else if (p ~ /^src\/datasets\//) { a="platform-readers"; s="4" }
    else if (p ~ /^src\/data\/(coords|cellid|gex|gexSelection|gexTypes|geneValues|geneExpression|geneExpressionLod|roiGeneStats|roiCells|roiSelection|roiTranscripts|transcriptZarr|units|transcriptFeatureTally|tileCellMeasure|tileSamples)\.ts$/) { a="shared-science"; s="3" }
    else if (p ~ /^src\/data\/(shareableState|customAnnotations)\.ts$/ || p ~ /^src\/features\/(annotations|roi)\//) { a="user-state-exports"; s="3,6" }
    else if (p ~ /^src\/data\/(rangeSupport|persistentByteRangeCache|zipArchive|zipFolder|zipEntryWorker|coalescingAsyncBuffer|hostResponses|h5WorkerFile|folderListing|readMaybeGzipText|urlFileName|duckdb|duckdbCells|hyparquetCells|parquetRows|parquetStructure|geojsonFeatureStream|featureBarcodeMatrixH5|xeniumDatasetCache|runtimeMemory)\.ts$/ || p ~ /^src\/(workers|zarr)\//) { a="io-hdf5-archives"; s="5" }
    else if (p ~ /^src\/(tiff|codecs|rendering|components)\// || p ~ /^src\/features\/(morphology|segmentation|transcripts)\// || p ~ /^src\/data\/(imagePyramid|imageVolume|morphologyContrast|morphologyImage|wktPolygons|transcriptOverlay|visiumHdGridLod|visiumFeatureSlice|visiumFeatureSliceH5)\.ts$/) { a="images-rendering"; s="4,6" }
    else if (p ~ /^src\/features\/(plots|query)\//) { a="plots-query"; s="3" }
    else if (p ~ /^src\/features\/collection\//) { a="collections-3d"; s="3,4" }
    else if (p ~ /^src\/(features|styles|utils|types)\// || p ~ /^src\/index\.css$|^src\/vite-env/) { a="ui-shell-other"; s="6,7" }
    else if (p ~ /^src\/data\//) { a="data-other"; s="3,5" }
    else { a="unmapped"; s="?" }
  } else if (kind=="documentation") { a="documentation"; s="2" }
  else if (kind=="plan-record") { a="plan-records"; s="1,2" }
  else if (kind=="schema" || kind=="example" || kind=="collection") { a="schemas-examples"; s="2" }
  else if (kind=="script") { a="scripts"; s="2,6" }
  else if (kind=="workflow" || kind=="config" || kind=="patch") { a="quality-delivery"; s="7" }
  else if (kind=="test") { a="tests"; s="7" }
  else if (kind=="fixture") { a="fixtures"; s="7" }
  printf "%s\t%s\t%s\t%s\t%s\tpending\n", kind, p, (p in lines ? lines[p] : ""), a, s
}' source-areas.tsv tracked-files.tsv > ledger.tsv
