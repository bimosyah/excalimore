import { Outlet, createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useLogout, useMe } from '../api/auth'
import { FolderSidebar } from './-components/FolderSidebar'

export const Route = createFileRoute('/_authed')({
  beforeLoad: async () => {
    const res = await fetch('/api/auth/me', { credentials: 'include' })
    if (res.status === 401) {
      throw redirect({ to: '/login' })
    }
  },
  component: AuthedLayout,
})

function AuthedLayout() {
  const me = useMe()
  const logout = useLogout()
  const navigate = useNavigate()

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <header className="app-sidebar-header">
          <h2>Excalimore</h2>
          {me.data && (
            <button
              type="button"
              onClick={async () => {
                await logout.mutateAsync()
                navigate({ to: '/login' })
              }}
              className="app-link-button"
              disabled={logout.isPending}
            >
              {me.data.name} · sign out
            </button>
          )}
        </header>
        <FolderSidebar />
      </aside>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}
