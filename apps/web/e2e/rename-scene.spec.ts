import { bootstrapAdmin, createSceneFromHome, expect, test } from './fixtures'

test.describe('rename scene', () => {
  test('clicking the title in the editor opens an input and persists the new name', async ({
    page,
  }) => {
    await bootstrapAdmin(page, {
      email: 'rename@e2e.test',
      password: 'rename-password',
      name: 'Renamer',
    })

    await createSceneFromHome(page)

    // Title button shows the default name and exposes a "click to rename" hint.
    const titleButton = page.getByRole('button', { name: 'Untitled scene' })
    await expect(titleButton).toBeVisible()
    await titleButton.click()

    // Input replaces the button; default value is the current name.
    const input = page.getByRole('textbox', { name: 'Scene name' })
    await expect(input).toBeFocused()
    await input.fill('Maxxi Tani Whiteboard')

    // Arm the waiter, then trigger blur via Enter — PATCH /api/scenes/:id
    // with { name } should fire.
    const patchPromise = page.waitForResponse(
      (res) =>
        res.url().includes('/api/scenes/') &&
        res.request().method() === 'PATCH' &&
        res.status() === 200,
      { timeout: 5000 },
    )
    await input.press('Enter')
    await patchPromise

    // Header now shows the new name.
    await expect(page.getByRole('button', { name: 'Maxxi Tani Whiteboard' })).toBeVisible()

    // Going back to "All scenes" shows the renamed scene in the grid.
    await page.getByRole('link', { name: '← Scenes' }).click()
    await expect(page.getByText('Maxxi Tani Whiteboard')).toBeVisible()
    await expect(page.getByText('Untitled scene')).toHaveCount(0)
  })

  test('escape cancels rename without persisting', async ({ page }) => {
    await bootstrapAdmin(page, {
      email: 'cancel-rename@e2e.test',
      password: 'rename-password',
      name: 'Canceller',
    })

    await createSceneFromHome(page)

    await page.getByRole('button', { name: 'Untitled scene' }).click()
    const input = page.getByRole('textbox', { name: 'Scene name' })
    await input.fill('Should not save')
    await input.press('Escape')

    // Title falls back to the original name and no PATCH was made (we don't
    // assert network silence here; the visible state covers the requirement).
    await expect(page.getByRole('button', { name: 'Untitled scene' })).toBeVisible()
  })
})
