import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: () => (
    <main style={{ padding: '2rem' }}>
      <h1>Home (Task 9)</h1>
    </main>
  ),
})
