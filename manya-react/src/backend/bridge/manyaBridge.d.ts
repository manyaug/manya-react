/**
 * ManyaBackend Bridge — TypeScript Type Definitions
 * ==================================================
 * The stable contract for window.ManyaBackend.
 * This file is the single source of truth for what JavaScript can call on the bridge.
 *
 * C# Implementation: ManyaApp/Services/BridgeService.cs
 * JS Wrapper:        src/backend/bridge/manyaBridge.js
 * C# Interface:      src/backend/bridge/IManyaBridge.cs
 *
 * Version: 1.0.0
 */

// ── Core Types ───────────────────────────────────────────────────────────────

export type DbIdentifier = 'user' | 'content';

export interface DbQueryOptions {
    orderBy?:  string;
    orderDir?: 'asc' | 'desc';
    limit?:    number;
    offset?:   number;
    columns?:  string[];
}

export interface DbOperation {
    op:      'upsert' | 'delete';
    table:   string;
    data?:   Record<string, unknown>;
    filter?: Record<string, unknown>;
}

export interface DbExecuteResult {
    rows:         Record<string, unknown>[];
    rowsAffected: number;
}

export interface FileInfo {
    name:     string;
    size:     number;
    modified: string; // ISO8601
}

export interface SyncStatus {
    pending:   number;
    lastSync:  string | null; // ISO8601 or null
    isOnline:  boolean;
}

export interface AuthSession {
    access_token:  string;
    refresh_token: string;
    user_id:       string;
    expires_at:    number; // Unix timestamp
}

export interface DeviceInfo {
    os:            string;  // 'android' | 'ios' | 'web'
    version:       string;  // OS version
    model:         string;
    locale:        string;
    appVersion:    string;  // Play Store app version
    bridgeVersion: string;  // BridgeService.cs version
}

// ── Sync Events fired by C# → React ──────────────────────────────────────────
export type BridgeEventName =
    | 'syncComplete'
    | 'networkChanged'
    | 'downloadProgress'
    | 'downloadComplete'
    | 'authExpired';

export interface NetworkChangedPayload { isOnline: boolean; }
export interface DownloadProgressPayload { path: string; bytesReceived: number; totalBytes: number; percent: number; }
export interface DownloadCompletePayload { path: string; size: number; }
export interface SyncCompletePayload     { pushed: number; failed: number; }

// ── The Full Bridge API ───────────────────────────────────────────────────────

export interface ManyaBackendDb {
    /**
     * Query rows. filter = key:value pairs joined with AND.
     * db='content' → content.db (READ-ONLY — C# enforces this).
     */
    query(
        db:      DbIdentifier,
        table:   string,
        filter:  Record<string, unknown>,
        options: DbQueryOptions
    ): Promise<Record<string, unknown>[]>;

    /** Insert or replace a row. */
    upsert(
        db:    DbIdentifier,
        table: string,
        data:  Record<string, unknown>
    ): Promise<{ id: unknown }>;

    /** Delete rows matching filter. */
    delete(
        db:     DbIdentifier,
        table:  string,
        filter: Record<string, unknown>
    ): Promise<{ affected: number }>;

    /** Parameterized raw SQL. For migrations and complex queries only. */
    execute(
        db:     DbIdentifier,
        sql:    string,
        params: unknown[]
    ): Promise<DbExecuteResult>;

    /**
     * Run multiple operations atomically.
     * Note: writing to 'content' db will throw — enforced by DbRouter.AssertWritable().
     */
    transaction(
        db:         DbIdentifier,
        operations: DbOperation[]
    ): Promise<{ success: boolean }>;
}

export interface ManyaBackendFiles {
    read(path: string, options?: { encoding?: 'utf8' | 'base64' }): Promise<string>;
    write(path: string, data: string, options?: { encoding?: 'utf8' | 'base64' }): Promise<{ size: number }>;
    delete(path: string): Promise<{ success: boolean }>;
    list(directory: string): Promise<FileInfo[]>;
    exists(path: string): Promise<boolean>;
    /** Downloads a file in the background. Progress fires via ManyaBackend.on('downloadProgress'). */
    download(url: string, localPath: string, options?: { sha256?: string }): Promise<{ path: string; size: number }>;
    /** Returns the absolute base path for file storage on this device. */
    basePath(): Promise<string>;
}

export interface ManyaBackendSync {
    /** Immediately flush sync_logs outbox to Supabase. */
    flush(): Promise<{ pushed: number; failed: number }>;
    /** Returns current sync status. */
    status(): Promise<SyncStatus>;
}

export interface ManyaBackendAuth {
    /** Get stored session tokens from C# SecureStorage. */
    getSession(): Promise<AuthSession | null>;
    /** Force refresh using stored refresh token. */
    refresh(): Promise<Pick<AuthSession, 'access_token' | 'expires_at'> | null>;
    /**
     * Called after React online login flow succeeds.
     * Persists tokens to C# SecureStorage for offline sync use.
     */
    setSession(accessToken: string, refreshToken: string): Promise<void>;
    /** Clear all stored tokens. */
    clear(): Promise<void>;
}

export interface ManyaBackendDevice {
    getInfo(): Promise<DeviceInfo>;
    isOnline(): Promise<boolean>;
    notify(title: string, body: string, options?: { badge?: number; sound?: boolean }): Promise<void>;
}

/**
 * The full window.ManyaBackend contract.
 * Injected by C# BridgeService.cs into the WebView's JavaScript context.
 */
export interface ManyaBackend {
    readonly version:      string;
    readonly capabilities: string[];

    readonly db:     ManyaBackendDb;
    readonly files:  ManyaBackendFiles;
    readonly sync:   ManyaBackendSync;
    readonly auth:   ManyaBackendAuth;
    readonly device: ManyaBackendDevice;

    on(event: BridgeEventName, callback: (payload: unknown) => void): void;
    off(event: BridgeEventName, callback: (payload: unknown) => void): void;
}

// Augment the global Window type
declare global {
    interface Window {
        ManyaBackend?: ManyaBackend;
    }
}
