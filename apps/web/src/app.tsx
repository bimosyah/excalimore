export function App() {
  return (
    <main style={{ padding: '2rem', maxWidth: '600px', margin: '0 auto' }}>
      <h1>Excalimore</h1>
      <p>Foundation phase — frontend skeleton wired up.</p>
      <p>
        API health: <ApiHealth />
      </p>
    </main>
  )
}

function ApiHealth() {
  // Lazy fetch via /api proxy; we'll replace with TanStack Query in Phase 4.
  return <span id="api-health">checking…</span>
}
