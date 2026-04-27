import { bootstrapAdmin, expect, placeComment, seedSceneWithRectangle, test } from './fixtures'

test.describe('anchored comments', () => {
  // Acceptance: place an anchored comment, reload, the comment is still pinned
  // to the same element. This is the spec §7 contract for Phase 5.
  test('places a comment that persists across reload', async ({ page }) => {
    await bootstrapAdmin(page, {
      email: 'commenter@e2e.test',
      password: 'commenter-password',
      name: 'Commenter',
    })

    const { sceneId } = await seedSceneWithRectangle(page)
    await page.goto(`/scenes/${sceneId}`)
    await expect(page.locator('canvas.excalidraw__canvas.interactive')).toBeVisible()

    await placeComment(page, 'first anchored comment')

    // Sidebar lists the comment.
    await expect(page.getByTestId('comment-sidebar-item')).toHaveCount(1)
    await expect(page.getByTestId('comment-sidebar-item').first()).toContainText(
      'first anchored comment',
    )

    // Reload — the pin and sidebar entry should persist.
    await page.reload()
    await expect(page.locator('canvas.excalidraw__canvas.interactive')).toBeVisible()
    await expect(page.getByTestId('comment-pin')).toBeVisible({ timeout: 5000 })
    await expect(page.getByTestId('comment-sidebar-item')).toHaveCount(1)
    await expect(page.getByTestId('comment-sidebar-item').first()).toContainText(
      'first anchored comment',
    )
  })
})
