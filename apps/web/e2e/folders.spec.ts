import { bootstrapAdmin, createFolder, createSceneFromHome, expect, test } from './fixtures'

test.describe('folders', () => {
  // Acceptance: "as user, bisa buat folder sesuai dengan yang di input"
  test('user can create a folder with the typed name', async ({ page }) => {
    await bootstrapAdmin(page, {
      email: 'folder-create@e2e.test',
      password: 'folder-password',
      name: 'Folder Maker',
    })

    await createFolder(page, 'Marketing')

    // Folder appears as a clickable link in the sidebar.
    await expect(page.getByRole('link', { name: 'Marketing' })).toBeVisible()
  })

  // Acceptance: "as user, file yang sudah di buat bisa di lihat lagi di dalam folder"
  test('a scene created while a folder is active is visible inside that folder', async ({
    page,
  }) => {
    await bootstrapAdmin(page, {
      email: 'folder-scene@e2e.test',
      password: 'folder-password',
      name: 'Folder User',
    })

    // 1. Create the folder and switch into it (filter the home grid by it).
    await createFolder(page, 'Projects')
    await page.getByRole('link', { name: 'Projects' }).click()
    await expect(page).toHaveURL(/\?folder=/)
    await expect(page.getByRole('heading', { name: /Scenes in this folder/ })).toBeVisible()
    await expect(page.getByText('No scenes in this folder yet.')).toBeVisible()

    // 2. Create a scene from this folder view — it should land in the folder.
    await createSceneFromHome(page)

    // 3. Navigate back to the home grid for that folder; the new scene shows up.
    await page.getByRole('link', { name: '← Scenes' }).click()
    await expect(page).toHaveURL(/\?folder=/)
    await expect(page.getByText('Untitled scene')).toBeVisible()

    // 4. Switching to "All scenes" still shows the new scene (it belongs to
    //    the user, just filtered by folder above).
    await page.getByRole('link', { name: 'All scenes' }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByText('Untitled scene')).toBeVisible()
  })
})
