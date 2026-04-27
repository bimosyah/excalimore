import { createFileRoute } from '@tanstack/react-router'

// Editor implementation lands in Task 10.
export const Route = createFileRoute('/_authed/scenes/$id')({
  component: () => (
    <main style={{ padding: '2rem' }}>
      <h1>Scene editor (Task 10)</h1>
    </main>
  ),
})
