/**
 * OFFLINE-FIRST FEATURES
 * ======================
 * All modules in this directory write to SQLite first and sync later.
 *
 * OFFLINE CONTRACT:
 *   Every function in this directory MUST:
 *   1. Write to user.db immediately via the bridge.
 *   2. Append a corresponding event to sync_logs via queueSyncEvent().
 *   3. Return success without waiting for any network call.
 *   4. NEVER block on network availability.
 *
 * Features:
 *   - learning/    → Answer questions, earn XP/Coins, mastery tracking
 *   - quests/      → Quest progress, node unlocks, star ratings
 *   - vault/       → Vault item unlocks
 *   - badges/      → Badge earn triggers
 *   - sessions/    → Study session start/end recording
 *   - balances/    → Local balance read (authoritative after sync)
 *
 * @see src/features/online/  for features that REQUIRE connectivity
 * @see src/backend/sync/syncService.js  for outbox flush logic
 */

export * from './learning/answerService.js';
export * from './quests/questService.js';
