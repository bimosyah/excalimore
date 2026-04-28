import { bootstrapAdmin, createSceneFromHome, expect, test } from './fixtures'

test.describe('scene thumbnails', () => {
  // End-to-end: editing a scene generates a PNG thumbnail, the API persists
  // it, and the home grid renders it as an <img> with a non-empty src on
  // reload. We don't pixel-match — just verify the thumbnail pipeline wires
  // canvas → debounced PATCH → list response → DOM image.
  test('a scene with edits gets a thumbnail rendered on the home grid', async ({ page }) => {
    await bootstrapAdmin(page, {
      email: 'thumb@e2e.test',
      password: 'thumb-password',
      name: 'Thumbnailer',
    })

    await createSceneFromHome(page)

    // Wait for Excalidraw's interactive layer to mount before drawing.
    const interactiveCanvas = page.locator('canvas.excalidraw__canvas.interactive')
    await expect(interactiveCanvas).toBeVisible()
    const box = await interactiveCanvas.boundingBox()
    if (!box) throw new Error('canvas has no bounding box')

    // Draw a rectangle: select the rect tool, then drag a box on the canvas.
    // Excalidraw's rectangle shortcut is the digit "2"; using the keyboard
    // here is more robust than hunting for the toolbar button across themes.
    await page.keyboard.press('2')
    const startX = box.x + box.width / 2 - 100
    const startY = box.y + box.height / 2 - 60
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX + 200, startY + 120, { steps: 10 })
    await page.mouse.up()

    // The thumbnail save is on a 5s debounce — wait for the PATCH that
    // carries the thumbnailUrl. The data save (also a PATCH) fires at 2s
    // with no thumbnailUrl; we filter on body to grab the right one.
    const thumbPatch = await page.waitForResponse(
      async (res) => {
        if (!res.url().includes('/api/scenes/')) return false
        if (res.request().method() !== 'PATCH') return false
        if (res.status() !== 200) return false
        const body = res.request().postData() ?? ''
        return body.includes('thumbnailUrl') && body.includes('data:image/png')
      },
      { timeout: 15_000 },
    )
    expect(thumbPatch.ok()).toBe(true)

    // Reload the home grid and confirm the card renders an <img> with a
    // non-empty data URL src. The card link is the deterministic anchor.
    await page.getByRole('link', { name: '← Scenes' }).click()
    await expect(page.getByRole('heading', { name: 'Your scenes' })).toBeVisible()

    const sceneCardImg = page.locator('.scene-card .scene-card-thumb img').first()
    await expect(sceneCardImg).toBeVisible()
    const src = await sceneCardImg.getAttribute('src')
    expect(src).toBeTruthy()
    expect(src ?? '').toMatch(/^data:image\//)
    expect((src ?? '').length).toBeGreaterThan(100)
  })
})
