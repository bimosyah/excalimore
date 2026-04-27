import { bootstrapAdmin, expect, resetDb, test } from './fixtures'

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
})
