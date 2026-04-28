import {
  bootstrapAdmin,
  createFolder,
  createSceneFromHome,
  expect,
  openFolderMenu,
  test,
} from './fixtures'

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

  // Acceptance: rename via the per-row menu, persists across reload.
  test('user can rename a folder from the sidebar menu', async ({ page }) => {
    await bootstrapAdmin(page, {
      email: 'folder-rename@e2e.test',
      password: 'folder-password',
      name: 'Folder Renamer',
    })

    await createFolder(page, 'Old Name')

    await openFolderMenu(page, 'Old Name')
    await page.getByRole('menuitem', { name: 'Rename' }).click()

    // The row swaps to an inline input. Type the new name and commit on Enter.
    const input = page.getByRole('textbox', { name: 'Folder name' })
    await expect(input).toBeVisible()
    await input.fill('New Name')
    await input.press('Enter')

    await expect(page.getByRole('link', { name: 'New Name' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Old Name' })).toHaveCount(0)

    // Persists across reload.
    await page.reload()
    await expect(page.getByRole('link', { name: 'New Name' })).toBeVisible()
  })

  // Acceptance: delete via the per-row menu, the row disappears.
  test('user can delete a folder from the sidebar menu', async ({ page }) => {
    await bootstrapAdmin(page, {
      email: 'folder-delete@e2e.test',
      password: 'folder-password',
      name: 'Folder Deleter',
    })

    await createFolder(page, 'Throwaway')

    await openFolderMenu(page, 'Throwaway')
    await page.getByRole('menuitem', { name: 'Delete' }).click()

    // Inline confirm dialog — click the destructive Delete button.
    const dialog = page.getByRole('dialog', { name: 'Confirm delete' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Delete' }).click()

    await expect(page.getByRole('link', { name: 'Throwaway' })).toHaveCount(0)
  })

  // Acceptance: deleting the currently filtered folder drops `?folder=` from URL.
  test('deleting the currently filtered folder redirects to root grid', async ({ page }) => {
    await bootstrapAdmin(page, {
      email: 'folder-delete-active@e2e.test',
      password: 'folder-password',
      name: 'Folder Filter Deleter',
    })

    await createFolder(page, 'Filtered')

    // Filter the home grid by the new folder.
    await page.getByRole('link', { name: 'Filtered' }).click()
    await expect(page).toHaveURL(/\?folder=/)
    await expect(page.getByRole('heading', { name: /Scenes in this folder/ })).toBeVisible()

    // Open the menu and delete the same folder we're currently filtered by.
    await openFolderMenu(page, 'Filtered')
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await page
      .getByRole('dialog', { name: 'Confirm delete' })
      .getByRole('button', {
        name: 'Delete',
      })
      .click()

    // The URL drops the folder filter and the heading flips back to "Your scenes".
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('heading', { name: 'Your scenes' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Filtered' })).toHaveCount(0)
  })
})
