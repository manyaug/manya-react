/**
 * ManyaBackend Bridge — React Wrapper & Web Fallback
 * ===================================================
 * This module provides the canonical JavaScript interface to window.ManyaBackend.
 *
 * On Android (MAUI WebView): window.ManyaBackend is injected by C# BridgeService.cs.
 * On Browser (dev/preview):  A mock fallback is used so React can run standalone.
 *
 * CRITICAL RULES:
 *   1. NEVER import from this file in online-only features. They call Supabase directly.
 *   2. ALWAYS use the typed methods below, not window.ManyaBackend directly.
 *   3. Check capabilities before using new bridge methods added in future versions.
 *
 * @see ManyaApp/Services/BridgeService.cs  for the C# implementation
 * @see ManyaApp/Data/DbRouter.cs           for the DB routing logic
 */

// ── Bridge Detection ──────────────────────────────────────────────────────────

/** Returns true if the C# native bridge is available. */
export const isBridgeAvailable = () =>
    typeof window !== 'undefined' && typeof window.ManyaBackend !== 'undefined';

/** Returns true if a specific capability is available in this bridge version. */
export const hasBridgeCapability = (cap) =>
    isBridgeAvailable() && Array.isArray(window.ManyaBackend.capabilities) &&
    window.ManyaBackend.capabilities.includes(cap);

// ── Web Fallback (IndexedDB mock for browser development) ─────────────────────
// This is a stub. Full browser mock lives in src/backend/bridge/webFallback.js
const _noop = async () => {};
const _webFallback = {
    version: '0.0.0-web',
    capabilities: [],
    db: {
        query:       async () => [],
        upsert:      async () => ({ id: null }),
        delete:      async () => ({ affected: 0 }),
        execute:     async () => ({ rows: [], rowsAffected: 0 }),
        transaction: async () => ({ success: false }),
    },
    files: {
        read:     async () => '',
        write:    async () => ({ size: 0 }),
        delete:   async () => ({ success: false }),
        list:     async () => [],
        exists:   async () => false,
        download: async () => ({ path: '', size: 0 }),
        basePath: async () => '',
    },
    sync: {
        flush:  async () => ({ pushed: 0, failed: 0 }),
        status: async () => ({ pending: 0, lastSync: null, isOnline: false }),
    },
    auth: {
        getSession: async () => null,
        refresh:    async () => null,
        setSession: async () => {},
        clear:      async () => {},
    },
    device: {
        getInfo:  async () => ({ os: 'web', version: '0', model: 'browser', locale: 'en', appVersion: '0', bridgeVersion: '0' }),
        isOnline: async () => navigator.onLine,
        notify:   _noop,
    },
    on:  () => {},
    off: () => {},
};

/** Get the bridge (native or fallback). Always use this, never access window.ManyaBackend directly. */
const bridge = () => isBridgeAvailable() ? window.ManyaBackend : _webFallback;

// =============================================================================
// DATABASE API
// Routes: 'user'    → user.db   (READ-WRITE)
//         'content' → content.db (READ-ONLY — C# enforces this)
// =============================================================================

/**
 * Query rows from a table.
 * @param {'user'|'content'} db
 * @param {string} table
 * @param {Record<string, any>} filter  — key:value pairs, all joined with AND
 * @param {{ orderBy?: string, limit?: number, offset?: number, columns?: string[] }} options
 * @returns {Promise<Array>}
 */
export const dbQuery = (db, table, filter = {}, options = {}) =>
    bridge().db.query(db, table, filter, options);

/**
 * Insert or replace a row.
 * @param {'user'|'content'} db
 * @param {string} table
 * @param {Record<string, any>} data
 * @returns {Promise<{ id: any }>}
 */
export const dbUpsert = (db, table, data) =>
    bridge().db.upsert(db, table, data);

/**
 * Delete rows matching filter.
 * @param {'user'|'content'} db
 * @param {string} table
 * @param {Record<string, any>} filter
 * @returns {Promise<{ affected: number }>}
 */
export const dbDelete = (db, table, filter) =>
    bridge().db.delete(db, table, filter);

/**
 * Execute raw parameterized SQL. Use only for migrations and complex queries.
 * @param {'user'|'content'} db
 * @param {string} sql       — SQL with ? placeholders
 * @param {Array}  params    — ordered values for placeholders
 * @returns {Promise<{ rows: Array, rowsAffected: number }>}
 */
export const dbExecute = (db, sql, params = []) =>
    bridge().db.execute(db, sql, params);

/**
 * Run multiple operations atomically.
 * @param {'user'|'content'} db
 * @param {Array<{ op: 'upsert'|'delete', table: string, data?: object, filter?: object }>} operations
 * @returns {Promise<{ success: boolean }>}
 */
export const dbTransaction = (db, operations) =>
    bridge().db.transaction(db, operations);

// =============================================================================
// AUTH API  (@online-only flows WRITE to this; sync SERVICE reads from it)
// =============================================================================

/**
 * Retrieve the stored session tokens.
 * @returns {Promise<{ access_token: string, refresh_token: string, user_id: string, expires_at: number } | null>}
 */
export const authGetSession = () => bridge().auth.getSession();

/**
 * Force refresh the access token using the stored refresh token.
 * @returns {Promise<{ access_token: string, expires_at: number } | null>}
 */
export const authRefresh = () => bridge().auth.refresh();

/**
 * Called by React's online login flow after Supabase Auth succeeds.
 * Persists tokens to C# SecureStorage for use by the offline sync service.
 * @param {string} accessToken
 * @param {string} refreshToken
 */
export const authSetSession = (accessToken, refreshToken) =>
    bridge().auth.setSession(accessToken, refreshToken);

/** Clear all stored tokens (logout). */
export const authClear = () => bridge().auth.clear();

// =============================================================================
// FILE API
// =============================================================================

export const filesRead    = (path, options = {}) => bridge().files.read(path, options);
export const filesWrite   = (path, data, options = {}) => bridge().files.write(path, data, options);
export const filesDelete  = (path) => bridge().files.delete(path);
export const filesList    = (directory) => bridge().files.list(directory);
export const filesExists  = (path) => bridge().files.exists(path);
export const filesDownload = (url, localPath, options = {}) => bridge().files.download(url, localPath, options);
export const filesBasePath = () => bridge().files.basePath();

// =============================================================================
// SYNC API
// =============================================================================

/**
 * Immediately flush the sync_logs outbox to Supabase.
 * Called by syncService.js when the device comes online.
 * @returns {Promise<{ pushed: number, failed: number }>}
 */
export const syncFlush = () => bridge().sync.flush();

/**
 * Get current sync status.
 * @returns {Promise<{ pending: number, lastSync: string|null, isOnline: boolean }>}
 */
export const syncStatus = () => bridge().sync.status();

// =============================================================================
// DEVICE API
// =============================================================================

/**
 * @returns {Promise<{ os: string, version: string, model: string, locale: string, appVersion: string, bridgeVersion: string }>}
 */
export const deviceGetInfo = () => bridge().device.getInfo();

/** @returns {Promise<boolean>} */
export const deviceIsOnline = () => bridge().device.isOnline();

/**
 * Show a local notification.
 * @param {string} title
 * @param {string} body
 * @param {{ badge?: number, sound?: boolean }} options
 */
export const deviceNotify = (title, body, options = {}) =>
    bridge().device.notify(title, body, options);

// =============================================================================
// EVENT CHANNEL (Native → React)
// C# fires events by calling EvaluateJavascript in the WebView.
// =============================================================================

/**
 * Subscribe to a native event.
 * @param {'syncComplete'|'networkChanged'|'downloadProgress'|'downloadComplete'|'authExpired'} event
 * @param {Function} callback
 */
export const bridgeOn  = (event, callback) => bridge().on(event, callback);

/** Unsubscribe from a native event. */
export const bridgeOff = (event, callback) => bridge().off(event, callback);

// =============================================================================
// VERSION INFO
// =============================================================================
export const getBridgeVersion = () =>
    isBridgeAvailable() ? window.ManyaBackend.version : '0.0.0-web';
