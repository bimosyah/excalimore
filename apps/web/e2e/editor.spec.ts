import { bootstrapAdmin, createSceneFromHome, expect, test } from './fixtures'

test.describe('scene editor', () => {
  // Acceptance: "as user, save experience ketika ada perubahan saja di board nya"
  // — the UX should not show "saving…" or fire PATCH calls while the user is
  // idle on the canvas. This guards against the regression where Excalidraw
  // fires onChange for hydration / viewport changes and we treat each one as
  // a real edit. The fix lives in `_authed.scenes.$id.tsx` (fingerprintElements).
  test('does not save while idle on a freshly opened scene', async ({ page }) => {
    await bootstrapAdmin(page, {
      email: 'editor@e2e.test',
      password: 'editor-password',
      name: 'Editor',
    })

    // Capture every PATCH /api/scenes/:id (the save call).
    const saveRequests: string[] = []
    page.on('request', (req) => {
      if (req.method() === 'PATCH' && /\/api\/scenes\/[0-9a-f-]+$/.test(req.url())) {
        saveRequests.push(req.url())
      }
    })

    await createSceneFromHome(page)

    // Wait for Excalidraw's interactive canvas to mount — that's the layer
    // that receives pointer events; once present the editor is ready.
    const interactiveCanvas = page.locator('canvas.excalidraw__canvas.interactive')
    await expect(interactiveCanvas).toBeVisible()

    // Allow any initial onChange calls from hydration / first paint to settle
    // (the fingerprint guard records the first call without saving, so this
    // is mostly belt-and-braces).
    await page.waitForTimeout(2500)

    // === Idle window ===
    // No interaction for >4s. Debounced save fires 2s after the trailing
    // change; with no real changes we expect zero saves in this window.
    const before = saveRequests.length
    await page.waitForTimeout(4500)
    expect(
      saveRequests.length,
      `unexpected save while idle: ${saveRequests.slice(before).join(', ')}`,
    ).toBe(before)

    // The "saving…" indicator in the editor header should also be absent.
    await expect(page.getByText('saving…')).toHaveCount(0)
  })
})
