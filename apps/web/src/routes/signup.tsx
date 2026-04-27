import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/signup')({
  component: () => (
    <main style={{ padding: '2rem' }}>
      <h1>Signup (Task 7)</h1>
    </main>
  ),
})
