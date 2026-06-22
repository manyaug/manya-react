/**
 * Migration Runner — user.db
 * ==========================
 * Runs on every React app boot. Applies any pending migrations to user.db.
 * This is the ONLY place that evolves the user.db schema.
 *
 * Strategy:
 *   - Read MAX(version) from schema_version table.
 *   - Filter MIGRATIONS array for version > current.
 *   - Apply each pending migration inside a transaction.
 *   - Record each applied migration in schema_version.
 *
 * SAFETY:
 *   - Each migration runs atomically (all-or-nothing).
 *   - A failed migration is rolled back and app boot continues safely.
 *   - The failing migration is logged for debugging.
 */

import { MIGRATIONS } from './migrations.js';
import { dbExecute, dbTransaction } from '../bridge/manyaBridge.js';

/**
 * Run all pending migrations against user.db.
 * Call this once during app initialization, before any other DB access.
 * @returns {Promise<{ applied: number, failed: number, errors: string[] }>}
 */
export async function runMigrations() {
    const errors = [];
    let applied = 0;
    let failed = 0;

    try {
        // Ensure schema_version table exists (bootstrapping).
        await dbExecute('user',
            `CREATE TABLE IF NOT EXISTS schema_version (
                version     INTEGER PRIMARY KEY,
                applied_at  TEXT NOT NULL,
                description TEXT
            )`,
            []
        );

        // Get current version.
        const result = await dbExecute('user',
            'SELECT MAX(version) AS v FROM schema_version',
            []
        );
        const currentVersion = result?.rows?.[0]?.v ?? 0;

        const pending = MIGRATIONS.filter(m => m.version > currentVersion)
            .sort((a, b) => a.version - b.version);

        if (pending.length === 0) {
            console.log('[Migrations] user.db is up to date (v' + currentVersion + ')');
            return { applied: 0, failed: 0, errors: [] };
        }

        console.log(`[Migrations] Applying ${pending.length} pending migration(s) to user.db...`);

        for (const migration of pending) {
            try {
                await dbTransaction('user', [
                    { op: 'execute', sql: migration.sql, params: [] },
                    {
                        op: 'upsert',
                        table: 'schema_version',
                        data: {
                            version:     migration.version,
                            applied_at:  new Date().toISOString(),
                            description: migration.description
                        }
                    }
                ]);
                console.log(`[Migrations] ✓ v${migration.version}: ${migration.description}`);
                applied++;
            } catch (err) {
                const msg = `Migration v${migration.version} failed: ${err?.message ?? String(err)}`;
                console.error('[Migrations]', msg, err);
                errors.push(msg);
                failed++;
                // Stop at first failure — subsequent migrations may depend on this one.
                break;
            }
        }
    } catch (err) {
        const msg = `Migration runner failed: ${err?.message ?? String(err)}`;
        console.error('[Migrations]', msg, err);
        errors.push(msg);
        failed++;
    }

    return { applied, failed, errors };
}
