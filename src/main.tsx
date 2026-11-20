import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import './index.css'
import { installZipFolderFetch } from './data/zipFolder'
import { installStaleChunkDetection } from './features/errors/staleChunk'
import { installWorkerZarrCodecs } from './zarr/workerZarrCodecs'

installWorkerZarrCodecs()
installZipFolderFetch()
installStaleChunkDetection()

const rootElement = document.getElementById('root')

if (rootElement === null) {
  throw new Error('Root element #root was not found.')
}

createRoot(rootElement).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
)
