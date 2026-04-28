import { bootstrapAdmin, createSceneFromHome, expect, test } from './fixtures'

test.describe('sharing UI', () => {
  // Acceptance: scene owner can open the Share modal, generate an invite URL,
  // see it surface in the DOM, and the modal lists existing access grants.
  // This is the §6 happy-path contract for Phase 6 (Sharing).
  test('owner can open Share modal, generate an invite link, and revoke access', async ({
    page,
  }) => {
    await bootstrapAdmin(page, {
      email: 'sharer@e2e.test',
      password: 'sharer-password',
      name: 'Sharer',
    })

    await createSceneFromHome(page)

    // The Share button is gated to scene owners — assert it exists for the
    // bootstrap admin (who created this scene and is therefore the owner).
    const shareButton = page.getByTestId('share-button')
    await expect(shareButton).toBeVisible()
    await shareButton.click()

    const modal = page.getByTestId('share-modal')
    await expect(modal).toBeVisible()

    // Generate an invite link. Default permission is "view" — leave the
    // expiry input blank so the server applies its default. We arm a waiter
    // for the invite POST so the assertion doesn't race the network.
    const invitePromise = page.waitForResponse(
      (res) =>
        res.url().includes('/api/auth/invite') &&
        res.request().method() === 'POST' &&
        res.status() === 200,
      { timeout: 5000 },
    )
    await page.getByTestId('share-generate-button').click()
    await invitePromise

    // The generated URL should appear in the DOM and point at /signup with
    // a token query param so the invitee lands on the right page.
    const inviteResult = page.getByTestId('share-invite-result')
    await expect(inviteResult).toBeVisible()
    const urlInput = inviteResult.locator('input.share-invite-url')
    const inviteUrl = await urlInput.inputValue()
    expect(inviteUrl).toMatch(/\/signup\?token=/)

    // The "Copy" button is wired to navigator.clipboard.writeText. We don't
    // exercise the actual clipboard here (Playwright's clipboard support is
    // browser-/permission-dependent); we just verify the button is present.
    await expect(page.getByTestId('share-copy-button')).toBeVisible()

    // === Revoke flow ===
    // To exercise revoke we need at least one grant. Reach into the API to
    // create a second user + a grant, then refresh the modal to see it.
    const cookies = await page.context().cookies()
    const csrf = cookies.find((c) => c.name === 'excalimore_csrf')?.value
    if (!csrf) throw new Error('csrf cookie missing — bootstrap should have set it')
    const ctx = page.context().request

    // Generate a fresh invite then sign up a second user via that token.
    // (Doing the full signup flow is more reliable than direct DB writes;
    // it also gives us a real user with a real grant.)
    const inviteRes = await ctx.post('/api/auth/invite', {
      headers: { 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' },
      data: {
        sceneId: extractSceneIdFromUrl(page.url()),
        permission: 'view',
      },
    })
    expect(inviteRes.ok()).toBe(true)
    const inviteJson = (await inviteRes.json()) as { token: string }

    // Sign up the invitee in a second browser context so we don't clobber
    // the admin's session in the current page.
    const browser = page.context().browser()
    if (!browser) throw new Error('test browser unavailable')
    const inviteeContext = await browser.newContext()
    try {
      const signupRes = await inviteeContext.request.post('/api/auth/signup', {
        headers: { 'Content-Type': 'application/json' },
        data: {
          token: inviteJson.token,
          email: 'invitee@e2e.test',
          password: 'invitee-password',
          name: 'Invitee',
        },
      })
      expect(signupRes.ok()).toBe(true)
    } finally {
      await inviteeContext.close()
    }

    // Reopen the modal to refresh the grants list (it was already open but
    // the grants query was issued on first mount; re-mount via close+open
    // forces a refetch and is also a useful UX assertion).
    await page.keyboard.press('Escape')
    await expect(modal).toHaveCount(0)
    await shareButton.click()
    await expect(modal).toBeVisible()

    const grantList = page.getByTestId('share-grant-list')
    await expect(grantList).toBeVisible()
    const grantItem = page.getByTestId('share-grant-item').first()
    await expect(grantItem).toContainText('invitee@e2e.test')

    // Revoke the grant. Watch for the DELETE so the next assertion doesn't
    // race the cache invalidation.
    const deletePromise = page.waitForResponse(
      (res) =>
        res.url().includes('/grants/') &&
        res.request().method() === 'DELETE' &&
        res.status() === 200,
      { timeout: 5000 },
    )
    await page.getByTestId('share-revoke-button').first().click()
    await deletePromise

    // List should now be empty (we only added the one grant).
    await expect(page.getByTestId('share-grant-item')).toHaveCount(0)
  })
})

function extractSceneIdFromUrl(url: string): string {
  const match = /\/scenes\/([0-9a-f-]+)/.exec(url)
  if (!match) throw new Error(`could not extract scene id from ${url}`)
  return match[1] as string
}
