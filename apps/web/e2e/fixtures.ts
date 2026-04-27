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
  await page.waitForURL('**/')
  await expect(page.getByRole('heading', { name: 'Your scenes' })).toBeVisible()
}

/** Log in via the form. Assumes the user already exists. */
export async function login(page: Page, args: { email: string; password: string }): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Email').fill(args.email)
  await page.getByLabel('Password').fill(args.password)
  await page.getByRole('button', { name: /Sign in/ }).click()
  await page.waitForURL('**/')
}

export const test = base
export { expect }
