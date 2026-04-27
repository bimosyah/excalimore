import { Outlet, createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useLogout, useMe } from '../api/auth'
import { useCollapsed } from '../lib/use-collapsed'
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
  const [collapsed, setCollapsed] = useCollapsed('excalimore.sidebar.left', false)

  return (
    <div className={`app-shell${collapsed ? ' app-shell--sidebar-collapsed' : ''}`}>
      {!collapsed && (
        <aside className="app-sidebar">
          <header className="app-sidebar-header">
            <div className="app-sidebar-title">
              <h2>Excalimore</h2>
              <button
                type="button"
                onClick={() => setCollapsed(true)}
                className="app-icon-button"
                aria-label="Collapse sidebar"
                title="Collapse sidebar"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M15 6l-6 6 6 6"
                    stroke="currentColor"
                    strokeWidth="2"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
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
      )}
      <main className="app-main">
        {collapsed && (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="app-floating-toggle app-floating-toggle--left"
            aria-label="Show sidebar"
            title="Show sidebar"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M9 6l6 6-6 6"
                stroke="currentColor"
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
        <Outlet />
      </main>
    </div>
  )
}
