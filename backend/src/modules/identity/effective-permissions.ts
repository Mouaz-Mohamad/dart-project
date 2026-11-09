// DART CODE GUIDE | backend/src/modules/identity/effective-permissions.ts
// One effective-permission calculation for sessions and deferred delivery.
import type { Pool, PoolClient } from "pg";
export async function effectivePermissionsForUser(userId: string, client: Pool | PoolClient): Promise<string[]> {
    const result = await client.query<{ key: string }>(
      `SELECT p.key
         FROM permissions p
         LEFT JOIN user_permission_overrides override
           ON override.user_id=$1 AND override.permission_id=p.id
        WHERE CASE
          WHEN p.key IN (
            'profile.read_own',
            'profile.update_own',
            'sessions.read_own',
            'sessions.revoke_own'
          ) THEN EXISTS (
            SELECT 1
              FROM user_roles ur
              JOIN role_permissions rp ON rp.role_id=ur.role_id
             WHERE ur.user_id=$1
               AND ur.revoked_at IS NULL
               AND rp.permission_id=p.id
          )
          WHEN override.allowed IS NOT NULL THEN override.allowed
          ELSE EXISTS (
            SELECT 1
              FROM user_roles ur
              JOIN role_permissions rp ON rp.role_id=ur.role_id
             WHERE ur.user_id=$1
               AND ur.revoked_at IS NULL
               AND rp.permission_id=p.id
          )
        END
        ORDER BY p.key`,
      [userId],
    );
    return result.rows.map((row) => row.key);
}
