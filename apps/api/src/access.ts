import { and, eq } from 'drizzle-orm'
import type { DbClient } from './db/client'
import { scenes, shareGrants } from './db/schema'

export type SceneRole = 'owner' | 'edit' | 'view' | 'none'

/**
 * Returns the caller's effective role on a scene:
 *   - 'owner' — they created the scene
 *   - 'edit'  — they have an `edit` share grant
 *   - 'view'  — they have a `view` share grant
 *   - 'none'  — no relationship (or scene doesn't exist)
 */
export async function getSceneAccess(
  db: DbClient,
  userId: string,
  sceneId: string,
): Promise<SceneRole> {
  const sceneRow = await db
    .select({ ownerId: scenes.ownerId })
    .from(scenes)
    .where(eq(scenes.id, sceneId))
    .limit(1)
  const scene = sceneRow[0]
  if (!scene) return 'none'
  if (scene.ownerId === userId) return 'owner'

  const grantRow = await db
    .select({ permission: shareGrants.permission })
    .from(shareGrants)
    .where(and(eq(shareGrants.sceneId, sceneId), eq(shareGrants.userId, userId)))
    .limit(1)
  const grant = grantRow[0]
  if (!grant) return 'none'
  return grant.permission === 'edit' ? 'edit' : 'view'
}

/** True iff the role permits at least the requested level. */
export function roleAllows(role: SceneRole, required: 'owner' | 'edit' | 'view'): boolean {
  if (role === 'none') return false
  if (required === 'view') return true
  if (required === 'edit') return role === 'owner' || role === 'edit'
  return role === 'owner'
}
