import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app'
import './styles.css'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Smoke check the proxy → API.
fetch('/api/health')
  .then((r) => r.json())
  .then((j: { status: string }) => {
    const el = document.getElementById('api-health')
    if (el) el.textContent = j.status
  })
  .catch(() => {
    const el = document.getElementById('api-health')
    if (el) el.textContent = 'unreachable'
  })
