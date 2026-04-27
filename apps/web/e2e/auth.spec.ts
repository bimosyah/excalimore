import { bootstrapAdmin, expect, login, resetDb, test } from './fixtures'

test.describe('auth flow', () => {
  test('redirects unauthenticated home to /login', async ({ page }) => {
    resetDb()
    await page.goto('/')
    await page.waitForURL('**/login')
    await expect(page.getByRole('heading', { name: /Sign in to Excalimore/ })).toBeVisible()
  })

  test('bootstrap signup creates the admin and lands on the scene grid', async ({ page }) => {
    await bootstrapAdmin(page, {
      email: 'admin@e2e.test',
      password: 'admin-password',
      name: 'Admin',
    })
    await expect(page.getByText(/Admin · sign out/)).toBeVisible()
  })

  // Acceptance: "as user, bisa login dan masih masuk ke app"
  test('user can log in and stays authenticated across reload', async ({ page }) => {
    // Seed the admin via the bootstrap path, then sign out so we have a real
    // login form to exercise.
    await bootstrapAdmin(page, {
      email: 'persist@e2e.test',
      password: 'persist-password',
      name: 'Persist',
    })
    await page.getByRole('button', { name: /sign out/ }).click()
    await page.waitForURL('**/login')

    // Log in via the form.
    await login(page, { email: 'persist@e2e.test', password: 'persist-password' })
    await expect(page.getByRole('heading', { name: 'Your scenes' })).toBeVisible()
    await expect(page.getByText(/Persist · sign out/)).toBeVisible()

    // Reload — the HttpOnly session cookie should still authenticate us; we
    // should not bounce to /login.
    await page.reload()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('heading', { name: 'Your scenes' })).toBeVisible()
    await expect(page.getByText(/Persist · sign out/)).toBeVisible()
  })
})
