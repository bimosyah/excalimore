import { execSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { type Page, test as base, expect } from '@playwright/test'

/**
 * Truncate the dev database to a known empty state. Called from tests that
 * need a clean slate (e.g. bootstrap flow). Runs against the local
 * docker-compose Postgres so the dev DB is the test DB — fast iteration is
 * the priority here.
 */
export function resetDb(): void {
  execSync(
    'docker compose -f ../api/docker-compose.dev.yml exec -T postgres ' +
      'psql -U excalimore -d excalimore -c ' +
      `"TRUNCATE users, bootstrap_tokens, sessions, scenes, folders, comments, share_grants, invite_tokens CASCADE;" > /dev/null`,
    { stdio: 'inherit' },
  )
}

/**
 * Seed a bootstrap token directly in the database and return it. The API
 * only issues bootstrap tokens at startup when the users table is empty,
 * which is awkward for tests that reset the DB between runs — so we bypass
 * that and write a fresh token whenever a test needs one.
 */
export function seedBootstrapToken(ttlSeconds = 3600): string {
  const token = randomBytes(32).toString('base64url')
  const expires = new Date(Date.now() + ttlSeconds * 1000).toISOString()
  execSync(
    `docker compose -f ../api/docker-compose.dev.yml exec -T postgres psql -U excalimore -d excalimore -c "INSERT INTO bootstrap_tokens (token, expires_at) VALUES ('${token}', '${expires}'::timestamptz);" > /dev/null`,
    { stdio: 'inherit' },
  )
  return token
}

/**
 * Sign up the first admin via the bootstrap link. Resets the DB and seeds a
 * fresh bootstrap token first so the test is self-contained.
 */
export async function bootstrapAdmin(
  page: Page,
  args: { email: string; password: string; name: string },
): Promise<void> {
  resetDb()
  const token = seedBootstrapToken()
  await page.goto(`/signup?bootstrap=${encodeURIComponent(token)}`)
  await page.getByLabel('Name').fill(args.name)
  await page.getByLabel('Email').fill(args.email)
  await page.getByLabel(/Password/).fill(args.password)
  await page.getByRole('button', { name: /Create account/ }).click()
  // Wait for the home grid to render — that's the deterministic landmark
  // post-signup. The URL settles to "/" but search-param flux makes a glob
  // match on it brittle; the heading is stable.
  await expect(page.getByRole('heading', { name: 'Your scenes' })).toBeVisible({ timeout: 10_000 })
}

/** Log in via the form. Assumes the user already exists. */
export async function login(page: Page, args: { email: string; password: string }): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Email').fill(args.email)
  await page.getByLabel('Password').fill(args.password)
  await page.getByRole('button', { name: /Sign in/ }).click()
  await expect(page.getByRole('heading', { name: 'Your scenes' })).toBeVisible({ timeout: 10_000 })
}

/**
 * Create a folder via the sidebar form. Returns once the folder appears in
 * the sidebar list so callers can immediately interact with it.
 */
export async function createFolder(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: '+ New folder' }).click()
  // The inline input is autofocused. Type the name and submit.
  const input = page.locator('.folder-input')
  await input.fill(name)
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('link', { name })).toBeVisible()
}

/**
 * Open the per-row "⋯" actions menu for a sidebar folder. Hovers the row to
 * make the trigger visible (the trigger is `opacity: 0` until hover/focus),
 * clicks it, and waits for the menu to appear before returning.
 */
export async function openFolderMenu(page: Page, folderName: string): Promise<void> {
  const row = page.locator('.folder-row', { hasText: folderName }).first()
  await row.hover()
  await row.getByRole('button', { name: `Folder actions for ${folderName}` }).click()
  await expect(row.getByRole('menu')).toBeVisible()
}

/**
 * Click "+ New scene" on the home page. Waits until the editor route renders
 * (the toolbar header link "← Scenes" is the deterministic landmark).
 */
export async function createSceneFromHome(page: Page): Promise<void> {
  await page.getByRole('button', { name: /\+ New scene/ }).click()
  await page.waitForURL(/\/scenes\//)
  await expect(page.getByRole('link', { name: '← Scenes' })).toBeVisible()
}

/**
 * Seed a scene via the API with a single rectangle so the comment e2e has a
 * deterministic element to anchor a comment to. The rectangle is centred at
 * the scene origin so Excalidraw's default viewport places it near the canvas
 * centre after hydration. Returns the scene id and the rectangle's element id.
 */
export async function seedSceneWithRectangle(
  page: Page,
): Promise<{ sceneId: string; elementId: string }> {
  const elementId = `rect-${randomBytes(8).toString('hex')}`
  const cookies = await page.context().cookies()
  const csrf = cookies.find((c) => c.name === 'excalimore_csrf')?.value
  if (!csrf) throw new Error('csrf cookie missing — did you bootstrap first?')
  const ctx = page.context().request

  const createRes = await ctx.post('/api/scenes', {
    headers: { 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' },
    data: { name: 'comment-test scene' },
  })
  if (!createRes.ok()) throw new Error(`create scene failed: ${createRes.status()}`)
  const created = (await createRes.json()) as { scene: { id: string } }
  const sceneId = created.scene.id

  // Place a rectangle that covers most of the visible canvas so the e2e can
  // click anywhere near the canvas centre and reliably hit the element.
  // Excalidraw's default appState puts scene point (0, 0) near the top-left
  // of the canvas; making the rectangle 2000×2000 starting at the origin
  // means a click anywhere in the upper-left quadrant of the canvas hits it.
  const data = {
    type: 'excalidraw',
    elements: [
      {
        id: elementId,
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 2000,
        height: 2000,
        angle: 0,
        strokeColor: '#000000',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 2,
        strokeStyle: 'solid',
        roughness: 1,
        opacity: 100,
        groupIds: [],
        frameId: null,
        index: 'a0',
        roundness: null,
        seed: 1,
        version: 1,
        versionNonce: 1,
        isDeleted: false,
        boundElements: [],
        updated: 1,
        link: null,
        locked: false,
        customData: undefined,
      },
    ],
    appState: {},
    files: {},
  }
  const patch = await ctx.patch(`/api/scenes/${sceneId}`, {
    headers: { 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' },
    data: { data },
  })
  if (!patch.ok()) throw new Error(`patch scene failed: ${patch.status()}`)

  return { sceneId, elementId }
}

/**
 * Place a comment on the scene currently open in the editor. Assumes the
 * scene has at least one element near the canvas centre (use
 * `seedSceneWithRectangle` for a deterministic setup).
 */
export async function placeComment(page: Page, body: string): Promise<void> {
  await page.getByTestId('comment-add-button').click()
  await expect(page.getByText('Click any element to attach a comment')).toBeVisible()
  const canvas = page.locator('canvas.excalidraw__canvas.interactive')
  const box = await canvas.boundingBox()
  if (!box) throw new Error('canvas has no bounding box')
  // Click somewhere inside the upper-left quadrant — the seeded rectangle
  // (2000×2000 from scene origin) covers it for any reasonable canvas size.
  await page.mouse.click(box.x + 200, box.y + 200)
  const composer = page.getByTestId('comment-composer')
  await expect(composer).toBeVisible()
  await composer.locator('textarea').fill(body)
  await composer.getByRole('button', { name: /Post/ }).click()
  await expect(page.getByTestId('comment-pin').first()).toBeVisible({ timeout: 5000 })
}

export const test = base
export { expect }
