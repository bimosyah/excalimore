import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/login')({
  component: () => (
    <main style={{ padding: '2rem' }}>
      <h1>Login (Task 6)</h1>
    </main>
  ),
})
