# Manya App — Architecture Proposal & Handoff Manual

> **Version:** 1.0  
> **Date:** June 2026  
> **Scope:** Hybrid React (WebView) + C# MAUI offline-first architecture

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [The Problem We Are Solving](#2-the-problem-we-are-solving)
3. [Guiding Principles](#3-guiding-principles)
4. [The Dual-Database Model](#4-the-dual-database-model)
5. [The Stable Bridge Contract](#5-the-stable-bridge-contract)
6. [The OTA Update Strategy](#6-the-ota-update-strategy)
7. [The Sync Architecture (Outbox Pattern)](#7-the-sync-architecture-outbox-pattern)
8. [Schema Migration Strategy](#8-the-schema-migration-strategy)
9. [Supabase Cloud Schema](#9-supabase-cloud-schema)
10. [File & Folder Structure](#10-file--folder-structure)
11. [Data Flow Diagrams](#11-data-flow-diagrams)
12. [What Requires a C# Update vs. What Doesn't](#12-what-requires-a-c-update-vs-what-doesnt)
13. [Phased Execution Plan](#13-phased-execution-plan)
14. [Risk Register](#14-risk-register)
15. [Glossary](#15-glossary)

---

## 1. Executive Summary

Manya is a Ugandan K12 EdTech application serving students in grades 4–7. The application must work reliably in low-connectivity environments while staying synchronized with a cloud backend (Supabase) when connectivity is available.

The chosen deployment model is:

- **Frontend:** React web app (hosted, served via WebView inside C# MAUI Android app)
- **Backend (Cloud):** Supabase (PostgreSQL + Auth + Storage)
- **Backend (Offline):** Two SQLite databases stored on-device
- **Bridge:** A stable, versioned C# class exposing generic I/O primitives to the React WebView

The critical design decision is: **the C# MAUI shell is a dumb infrastructure host.** All business logic, UI, and data orchestration lives in the React app, which can be updated silently over the air (OTA) without requiring the user to visit the Play Store.

---

## 2. The Problem We Are Solving

### 2.1 What We Had Before

- One monolithic SQLite database on-device
- Supabase schema using PostgreSQL-specific features (partitioned tables, `uuid`, `jsonb`, `boolean`) that do not translate cleanly to SQLite
- Schema mismatches between Supabase and SQLite causing silent data corruption
- No strategy for updating the schema when the app evolved
- No clear contract between the React frontend and the C# MAUI shell
- All user data at risk of loss during any schema migration

### 2.2 What We Are Building

A system where:

- **Content** (questions, vault items, challenges) is treated like software — versioned, downloaded, replaceable
- **User state** (progress, balances, answers) is precious — never replaced, only incrementally migrated
- **The C# shell** exposes a fixed API surface that never needs to change for business logic updates
- **The React app** handles all feature evolution, schema migrations, sync logic, and content version checks via OTA updates

---

## 3. Guiding Principles

| # | Principle | What It Means in Practice |
|---|---|---|
| 1 | **Content ≠ User Data** | Never store questions and user progress in the same database |
| 2 | **OTA-first** | Every feature addition should be deployable without a Play Store update |
| 3 | **Offline-first** | Every user action writes locally first. Cloud sync is always background |
| 4 | **Server is authoritative** | For conflicts, the server wins. Client sends events; server computes canonical state |
| 5 | **Stable bridge surface** | C# exposes ~25 generic methods. Never adds app-specific logic to the bridge |
| 6 | **Additive-only migrations** | New columns added, old columns never renamed or removed in SQLite |
| 7 | **Graceful degradation** | If a bridge capability is missing (old app), the React UI degrades safely, not crashes |

---

## 4. The Dual-Database Model

### The Core Separation

```
Android Device Storage
├── content.db     ← READ ONLY on device. All shared educational content.
│                     Replaced atomically when a new version is available.
│                     Safe to delete and re-download at any time.
│
└── user.db        ← READ/WRITE. All user-specific state.
                      NEVER replaced. Only incrementally migrated.
                      Loss of this file = loss of all user progress.
```

### 4.1 content.db — What Goes Here

This database is pre-seeded and shipped from your server. It is identical for all users with the same grade level.

| Table | Description |
|---|---|
| `questions_math` | All math questions by grade |
| `questions_english` | All English questions by grade |
| `questions_science` | All science questions by grade |
| `questions_sst` | All SST questions by grade |
| `manya_vault_math` | Vault asset entries for math |
| `manya_vault_english` | Vault asset entries for English |
| `manya_vault_science` | Vault asset entries for science |
| `manya_vault_sst` | Vault asset entries for SST |
| `challenges` | Challenge definitions |
| `quests` | Quest definitions and reward structures |
| `badges` | Badge definitions and criteria |
| `content_version` | Single-row table: `{ version: "2.1.4", released_at: "..." }` |

**Key rule:** The React app and C# bridge only **read** from `content.db`. No user writes go here.

### 4.2 user.db — What Goes Here

This database is created fresh on first app install and persists for the lifetime of the user's device installation.

| Table | Description |
|---|---|
| `users` | User profile (name, grade, school, avatar) |
| `user_balances` | Current coins, gems, XP (authoritative on server) |
| `user_transactions` | Ledger of every balance change (append-only) |
| `user_answers` | Every answer the user has submitted |
| `user_vault` | Vault items the user has unlocked |
| `user_sessions` | Study session records |
| `concept_mastery` | Per-concept mastery scores |
| `quest_progress` | Progress on active quests |
| `user_badges` | Badges earned |
| `user_streaks` | Daily streak records |
| `sync_logs` | Outbox: pending events to push to Supabase |
| `schema_version` | Current migration version of this user.db |

**Key rule:** Nothing from `content.db` is duplicated here. User state references content by ID only.

---

## 5. The Stable Bridge Contract

The C# MAUI bridge exposes a single global JavaScript object: `window.ManyaBackend`.

This object's API surface is **fixed**. Every method takes an options object (not positional parameters) so future options can be added without breaking existing callers.

### 5.1 The Full Bridge API

```javascript
window.ManyaBackend = {

  // ── Meta ────────────────────────────────────────────────────────────────────
  version: "1.0.0",
  capabilities: ["db", "files", "sync", "auth", "device"],

  // ── Database ─────────────────────────────────────────────────────────────────
  //   db parameter: "user" | "content"
  db: {
    // Read rows. filter is key:value pairs (all joined with AND).
    // options: { orderBy, limit, offset, columns }
    query(db, table, filter, options) → Promise<Row[]>,

    // Insert or replace. data is a plain object.
    upsert(db, table, data) → Promise<{ id }>,

    // Delete rows matching filter.
    delete(db, table, filter) → Promise<{ affected }>,

    // Parameterized raw SQL. For migrations and complex queries only.
    // params: array of values matching ? placeholders.
    execute(db, sql, params) → Promise<{ rows, rowsAffected }>,

    // Run multiple operations atomically. Operations are array of
    // { op: "upsert"|"delete", table, data|filter } objects.
    transaction(db, operations) → Promise<{ success }>,
  },

  // ── File I/O ─────────────────────────────────────────────────────────────────
  //   All paths are relative to the app's document root.
  files: {
    read   (path, options) → Promise<string>,         // text or base64
    write  (path, data, options) → Promise<{ size }>, // creates dirs as needed
    delete (path) → Promise<{ success }>,
    list   (directory) → Promise<FileInfo[]>,          // [{ name, size, modified }]
    exists (path) → Promise<boolean>,
    // Downloads a file in the background. onProgress fires via ManyaBackend.on().
    download(url, localPath, options) → Promise<{ path, size }>,
    // Returns the absolute base path for storage on this device.
    basePath() → Promise<string>,
  },

  // ── Sync ─────────────────────────────────────────────────────────────────────
  sync: {
    // Immediately flush outbox (sync_logs) to Supabase.
    flush() → Promise<{ pushed, failed }>,
    // Returns { pending, lastSync, isOnline }
    status() → Promise<SyncStatus>,
  },

  // ── Auth ─────────────────────────────────────────────────────────────────────
  auth: {
    getSession() → Promise<{ access_token, refresh_token, user_id, expires_at }>,
    // Force a token refresh using the stored refresh_token.
    refresh() → Promise<{ access_token, expires_at }>,
    // Called after the React login flow completes.
    setSession(access_token, refresh_token) → Promise<void>,
    clear() → Promise<void>,
  },

  // ── Device ───────────────────────────────────────────────────────────────────
  device: {
    getInfo() → Promise<{ os, version, model, locale, appVersion, bridgeVersion }>,
    isOnline() → Promise<boolean>,
    // Show a local notification.
    notify(title, body, options) → Promise<void>,
  },

  // ── Event channel (native → React) ───────────────────────────────────────────
  //   C# fires these by calling EvaluateJavascript.
  on(event, callback) → void,
  off(event, callback) → void,
  // Events fired by native: "syncComplete" | "networkChanged" |
  //                         "downloadProgress" | "downloadComplete" | "authExpired"
}
```

### 5.2 Why Options Objects Matter

```javascript
// ❌ Fragile — adding a 5th param breaks every existing caller
db.query("user", "users", filter, "created_at", 20)

// ✅ Stable — new options are ignored by old bridge, callers unaffected
db.query("user", "users", filter, { orderBy: "created_at", limit: 20, offset: 0 })
```

The C# deserializer reads only the keys it knows. Unknown keys from future React updates are silently ignored. Old callers work because new options always have defaults.

### 5.3 Capability Discovery in React

```javascript
// React OTA update adds camera feature.
// Some users may have old bridge installed without camera capability.
if (window.ManyaBackend.capabilities.includes('camera')) {
  // Use native camera
  const photo = await window.ManyaBackend.device.camera();
} else {
  // Graceful fallback — prompt user to update app
  showUpdatePrompt("Update the app to unlock photo uploads");
}
```

This prevents crashes on old bridge versions. New capabilities are added to the
`capabilities` array and documented in bridge release notes.

---

## 6. The OTA Update Strategy

### 6.1 React App (Business Logic & UI)

The React app is hosted on a web server. The C# WebView loads it from a URL.

```
App boot
  ↓
WebView loads https://app.manya.ug/index.html
  ↓
React app loads fully (latest version automatically)
  ↓
React calls window.ManyaBackend.db / files / etc.
```

**No Play Store update required for:**
- New UI features
- New database tables or columns
- New sync logic
- New question formats
- New vault types
- New quests or challenges
- Bug fixes

**Play Store update required for:**
- New native hardware access (camera, microphone, biometrics)
- New background processing (background sync while app is closed)
- New platform permission requests
- New bridge methods

### 6.2 Content Database (content.db)

Content evolves independently of the user's React app version.

```
Server: https://cdn.manya.ug/content/
  ├── manifest.json               ← { version: "2.1.4", bundles: [...] }
  └── bundles/
      ├── math_g4_v2.1.4.sqlite
      ├── math_g5_v2.1.4.sqlite
      ├── english_g4_v2.1.4.sqlite
      └── ...
```

**Update flow (React app manages this entirely):**

```javascript
// On app boot, React handles content version checking
async function checkContentVersion() {
  const manifest = await fetch('https://cdn.manya.ug/content/manifest.json');
  const local = await window.ManyaBackend.db.query(
    "content", "content_version", {}, {}
  );

  if (manifest.version === local[0]?.version) return; // up to date

  // Download only changed subject bundles in background
  for (const bundle of manifest.bundles) {
    if (bundle.version !== local[0]?.bundles[bundle.subject]) {
      window.ManyaBackend.files.download(
        bundle.url,
        `content/${bundle.subject}_${bundle.grade}.sqlite`
      );
    }
  }

  // Bridge swaps the file when download completes
  window.ManyaBackend.on('downloadComplete', handleContentSwap);
}
```

**Key rule:** Only the changed subject bundle is downloaded, not the entire database.
A student in G4 studying math only downloads the math_g4 bundle.

### 6.3 User Database (user.db) — Schema Migrations

User.db is never replaced. When the schema needs to change, migrations run on boot.

See Section 8 for full detail.

---

## 7. The Sync Architecture (Outbox Pattern)

### 7.1 The Mental Model

```
User does something
  ↓
Write to user.db immediately (optimistic)
  ↓
Append event to sync_logs (outbox)
  ↓
Update UI (instant, no waiting for network)
  ↓ (background, when online)
Sync service flushes outbox to Supabase
  ↓
Server processes events, returns canonical state
  ↓
React updates local state from server response
```

The user never waits for the network. Every action feels instant.

### 7.2 The sync_logs Table

```sql
CREATE TABLE sync_logs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type   TEXT    NOT NULL,  -- 'ANSWER_SUBMITTED' | 'QUEST_COMPLETED' | etc.
  payload      TEXT    NOT NULL,  -- JSON string of event data
  created_at   TEXT    NOT NULL,  -- ISO8601 timestamp
  synced_at    TEXT,              -- NULL until confirmed by Supabase
  retry_count  INTEGER DEFAULT 0,
  error        TEXT               -- Last error message if any
);
```

### 7.3 Event Types

| Event Type | Payload Contains | Supabase Target |
|---|---|---|
| `ANSWER_SUBMITTED` | question_id, answer, is_correct, duration_ms, session_id | `user_answers` |
| `SESSION_STARTED` | session_id, subject, grade, mode | `user_sessions` |
| `SESSION_ENDED` | session_id, total_questions, correct, xp_earned | `user_sessions` |
| `QUEST_COMPLETED` | quest_id, reward_coins, reward_xp | `quest_progress` |
| `VAULT_UNLOCKED` | vault_item_id, cost_coins | `user_vault` |
| `BADGE_EARNED` | badge_id | `user_badges` |
| `COINS_CHANGED` | delta, reason, reference_id | `user_transactions` |
| `STREAK_UPDATED` | current_streak, last_study_date | `user_streaks` |
| `MASTERY_UPDATED` | concept_id, new_score | `concept_mastery` |

### 7.4 Sync Service Flow (React-managed)

```javascript
// syncService.js — runs in React, calls window.ManyaBackend

async function flushOutbox() {
  // 1. Check connectivity
  const online = await window.ManyaBackend.device.isOnline();
  if (!online) return { pushed: 0, reason: "offline" };

  // 2. Refresh auth token
  const session = await window.ManyaBackend.auth.refresh();
  if (!session.access_token) return { pushed: 0, reason: "auth_failed" };

  // 3. Read pending events
  const pending = await window.ManyaBackend.db.query(
    "user", "sync_logs",
    { synced_at: null },
    { orderBy: "created_at", limit: 100 }
  );

  if (pending.length === 0) return { pushed: 0, reason: "empty" };

  // 4. POST batch to Supabase RPC
  const result = await supabase.rpc('process_sync_batch', {
    events: pending,
    client_version: window.ManyaBackend.version
  });

  // 5. Mark confirmed events as synced
  for (const confirmed of result.confirmed) {
    await window.ManyaBackend.db.execute(
      "user",
      "UPDATE sync_logs SET synced_at = ? WHERE id = ?",
      [new Date().toISOString(), confirmed.id]
    );
  }

  // 6. Update local balances from server's canonical response
  if (result.canonical_balances) {
    await window.ManyaBackend.db.upsert(
      "user", "user_balances", result.canonical_balances
    );
  }

  return { pushed: result.confirmed.length };
}
```

### 7.5 Conflict Resolution Rules

| Data Type | Resolution Strategy | Why |
|---|---|---|
| Coins / Gems / XP | Server ledger — `SUM(transactions)` | Prevents double-spend |
| Streak | Server wins (MAX date) | Prevents rewind |
| Mastery score | Server wins (MAX score) | Never lower a mastery score |
| Answers | Append-only, no conflict | Historical record |
| User profile | `updated_at` timestamp wins | Last write wins |
| Vault items | Union — client + server | Never remove unlocked items |
| Badges | Union — client + server | Never revoke earned badges |

### 7.6 Pre-Replacement Flush (Content DB Update)

When a content database update is detected and ready to swap:

```javascript
async function safeContentSwap(newDbPath, subject, grade) {
  // 1. Flush ALL pending events first
  const result = await flushOutbox();

  // 2. Only proceed if outbox is empty
  const remaining = await window.ManyaBackend.db.query(
    "user", "sync_logs", { synced_at: null }, {}
  );

  if (remaining.length > 0) {
    // Cannot swap. Will retry next time device is online.
    scheduleRetry();
    return;
  }

  // 3. Swap is now safe — no user data at risk
  await window.ManyaBackend.files.write(
    `content/${subject}_${grade}.sqlite`,
    newDbPath
  );
}
```

---

## 8. The Schema Migration Strategy

### 8.1 The schema_version Table

Every `user.db` contains this table:

```sql
CREATE TABLE schema_version (
  version     INTEGER PRIMARY KEY,
  applied_at  TEXT    NOT NULL,
  description TEXT
);
```

### 8.2 Migrations File (Shipped with React App OTA)

```javascript
// src/db/migrations.js — updated with every schema change
export const MIGRATIONS = [
  {
    version: 1,
    description: "Initial schema",
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, name TEXT, grade INTEGER,
        school_id TEXT, avatar TEXT, created_at TEXT
      );
      CREATE TABLE IF NOT EXISTS user_balances (
        user_id TEXT PRIMARY KEY, coins INTEGER DEFAULT 0,
        gems INTEGER DEFAULT 0, xp INTEGER DEFAULT 0,
        updated_at TEXT
      );
      -- ... all initial tables
    `
  },
  {
    version: 2,
    description: "Add weekly_xp to user_balances",
    sql: `ALTER TABLE user_balances ADD COLUMN weekly_xp INTEGER DEFAULT 0;`
  },
  {
    version: 3,
    description: "Add concept_mastery table",
    sql: `
      CREATE TABLE IF NOT EXISTS concept_mastery (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT, concept_id TEXT, score REAL,
        updated_at TEXT
      );
    `
  }
  // New migrations are appended here — never edit existing ones
];
```

### 8.3 Migration Runner (React, on every boot)

```javascript
// src/db/migrationRunner.js
import { MIGRATIONS } from './migrations.js';

export async function runMigrations() {
  const result = await window.ManyaBackend.db.execute(
    "user",
    "SELECT MAX(version) as v FROM schema_version",
    []
  );
  const currentVersion = result.rows[0]?.v ?? 0;

  const pending = MIGRATIONS.filter(m => m.version > currentVersion);

  for (const migration of pending) {
    await window.ManyaBackend.db.transaction("user", [
      { op: "execute", sql: migration.sql },
      {
        op: "upsert",
        table: "schema_version",
        data: {
          version: migration.version,
          applied_at: new Date().toISOString(),
          description: migration.description
        }
      }
    ]);
    console.log(`Migration ${migration.version} applied: ${migration.description}`);
  }
}
```

**Rule:** Migrations are **append-only**. Never edit a migration that has already been released. Only add new migrations at the end.

---

## 9. Supabase Cloud Schema

### 9.1 Changes from Original Schema

The original Supabase schema used PostgreSQL-specific features that caused mismatches with SQLite. The following changes are applied to make the schemas mirror each other:

| Original | Changed To | Reason |
|---|---|---|
| PostgreSQL table partitions | Flat subject tables | SQLite has no partitioning |
| `uuid` primary keys | `TEXT` primary keys | SQLite stores UUIDs as TEXT |
| `boolean` columns | `INTEGER (0/1)` | SQLite has no boolean type |
| `jsonb` columns | `TEXT` (serialized JSON) | SQLite has no JSON type |
| `SERIAL` auto-increment | `INTEGER PRIMARY KEY` | SQLite auto-increment syntax |
| `timestamptz` | `TEXT` (ISO8601) | SQLite stores dates as text |

### 9.2 Table Naming Convention

```
Content tables:    questions_{subject}       (math, english, science, sst)
                   manya_vault_{subject}
                   challenges, quests, badges

User tables:       users, user_balances, user_transactions
                   user_answers, user_vault, user_sessions
                   concept_mastery, quest_progress
                   user_badges, user_streaks

Sync tables:       sync_logs (local only — not in Supabase)
System tables:     schema_version (local only — not in Supabase)
                   content_version (content.db only)
```

### 9.3 Supabase RPC Endpoints Required

| RPC | Description |
|---|---|
| `process_sync_batch(events, client_version)` | Receives array of events, applies ledger logic, returns canonical state |
| `get_user_state(user_id)` | Returns full user state for fresh install sync |
| `validate_session(user_id)` | Returns current canonical balances and streak |

---

## 10. File & Folder Structure

### 10.1 React App (manya-react)

```
manya-react/
├── src/
│   ├── backend/
│   │   ├── bridge/
│   │   │   └── manyaBackend.js        ← Bridge wrapper (web fallback for browser)
│   │   ├── db/
│   │   │   ├── migrations.js          ← All schema migrations
│   │   │   ├── migrationRunner.js     ← Runs pending migrations on boot
│   │   │   └── queryHelpers.js        ← Typed query builders over bridge
│   │   ├── sync/
│   │   │   └── syncService.js         ← Outbox flush, conflict resolution
│   │   ├── content/
│   │   │   └── contentVersionChecker.js ← Checks and downloads content bundles
│   │   └── storage/
│   │       └── storageFacade.js       ← Routes reads between content.db / user.db
│   └── ...
│
└── sql/
    ├── sqlite_user_schema.sql         ← DDL for user.db (all user tables)
    ├── sqlite_content_schema.sql      ← DDL for content.db (all content tables)
    └── supabase_schema.sql            ← Mirror schema for Supabase
```

### 10.2 C# MAUI App (ManyaApp)

```
ManyaApp/
├── Services/
│   ├── BridgeService.cs               ← Registers window.ManyaBackend
│   ├── DatabaseService.cs             ← SQLite read/write via db.query/upsert/etc.
│   ├── FileService.cs                 ← File read/write/download via files.*
│   ├── AuthService.cs                 ← Token storage/refresh via auth.*
│   ├── SyncService.cs                 ← Called by sync.flush()
│   └── DeviceService.cs               ← Device info, notifications
│
├── Data/
│   └── DbRouter.cs                    ← Routes "user" vs "content" to correct .db file
│
└── Resources/
    └── seed/
        └── content_v1.0.0.sqlite      ← Bundled starter content.db (schema only)
```

### 10.3 CDN Server Structure

```
cdn.manya.ug/
└── content/
    ├── manifest.json                  ← { version, bundles: [{ subject, grade, url, hash }] }
    └── bundles/
        ├── math_g4_v2.1.4.sqlite
        ├── math_g5_v2.1.4.sqlite
        ├── english_g4_v2.1.4.sqlite
        └── ...
```

---

## 11. Data Flow Diagrams

### 11.1 App Boot Sequence

```
App Launched
     │
     ▼
WebView loads React App (from URL — latest OTA version)
     │
     ▼
React: runMigrations()        ← Apply any new schema changes to user.db
     │
     ▼
React: checkContentVersion()  ← Compare manifest to local content_version
     │             │
  Up to date    Outdated
     │             │
     │             ▼
     │        Download changed bundles in background (non-blocking)
     │
     ▼
React: auth.getSession()      ← Load stored JWT from C# secure storage
     │
     ▼
React: sync.flush()           ← Push any pending outbox events to Supabase
     │
     ▼
App is ready for use
```

### 11.2 User Answers a Question (Offline-First)

```
User taps an answer
     │
     ▼
React: db.upsert("user", "user_answers", { ... })     ← Instant local write
     │
     ▼
React: db.upsert("user", "sync_logs", {               ← Queue for cloud sync
          event_type: "ANSWER_SUBMITTED",
          payload: JSON.stringify({ ... })
        })
     │
     ▼
UI updates immediately (no network wait)
     │
     ▼ (background)
SyncService.flush() when network available
     │
     ▼
Supabase RPC processes event, returns canonical state
     │
     ▼
React: db.upsert("user", "user_balances", serverBalance)  ← Trust server
```

### 11.3 Content Database Swap

```
manifest.json version > local content_version
     │
     ▼
Download new bundle to temp path (background)
     │
     ▼
Download complete
     │
     ▼
flushOutbox() — push ALL pending events to Supabase
     │
     ▼
Wait: sync_logs WHERE synced_at IS NULL = 0 rows?
     │ No                     │ Yes
     │                        ▼
Retry next online session   Swap content.db file atomically
                                        │
                                        ▼
                            Update content_version in new content.db
                                        │
                                        ▼
                            React reloads content queries from new DB
```

---

## 12. What Requires a C# Update vs. What Doesn't

### ✅ Does NOT Require C# Update (OTA via React)

- New screens, pages, UI components
- New database tables or columns
- New question types or formats
- New vault item types
- New quest structures or reward logic
- New sync event types
- New content version checks or download logic
- New business rules (scoring, mastery thresholds)
- Bug fixes in data logic
- New Supabase RPC calls
- New animation or design updates
- A/B testing different features
- New grade levels or subjects

### ❌ Requires C# Update (Play Store release)

| Feature | New Bridge Method |
|---|---|
| Camera for photo upload | `device.camera()` |
| Microphone for audio answers | `device.microphone()` |
| Biometric login | `auth.biometric()` |
| Background sync (app closed) | `sync.scheduleBackground()` |
| Remote push notifications | `device.registerPush()` |
| Native file picker | `files.pick()` |
| Bluetooth / NFC | `device.ble()` |
| App badge count | `device.setBadge()` |
| Deep link handling | `device.onDeepLink()` |
| Video player (native) | `device.video()` |

**Pattern for handling this gracefully in React:**

```javascript
async function takePhoto() {
  if (!window.ManyaBackend.capabilities.includes('camera')) {
    // Show update prompt instead of crashing
    showDialog({
      title: "Update Required",
      message: "Please update the Manya app to use photo uploads.",
      action: "Open Play Store"
    });
    return;
  }
  const photo = await window.ManyaBackend.device.camera();
  // proceed...
}
```

---

## 13. Phased Execution Plan

### Phase 1 — Foundation (Week 1–2)

**Goal:** Get the dual-database model and bridge contract in place.

- [ ] Write `sqlite_user_schema.sql` — all user tables with no PostgreSQL-specific types
- [ ] Write `sqlite_content_schema.sql` — all content tables (flat, no partitions)
- [ ] Implement `BridgeService.cs` — registers `window.ManyaBackend` in WebView
- [ ] Implement `DatabaseService.cs` — handles `db.query`, `db.upsert`, `db.delete`, `db.execute`, `db.transaction`
- [ ] Implement `DbRouter.cs` — routes "user" / "content" to correct `.db` file
- [ ] Implement `FileService.cs` — handles `files.read`, `files.write`, `files.delete`, `files.list`, `files.download`
- [ ] Implement `AuthService.cs` — secure token storage + refresh
- [ ] Update `manyaDB.js` (React bridge wrapper) to use new `window.ManyaBackend` API

### Phase 2 — Migrations & Boot Sequence (Week 2–3)

**Goal:** React app handles its own schema evolution safely.

- [ ] Write `migrations.js` — initial migration (version 1) with all current tables
- [ ] Write `migrationRunner.js` — runs pending migrations on boot
- [ ] Integrate migration runner into React app boot sequence
- [ ] Test migration across: fresh install, existing install, version jump of 2+

### Phase 3 — Sync Architecture (Week 3–4)

**Goal:** Outbox pattern fully operational.

- [ ] Refactor `syncService.js` — switch from direct Supabase calls to outbox pattern
- [ ] Write Supabase RPC `process_sync_batch` — receives events, applies ledger logic
- [ ] Write Supabase RPC `get_user_state` — full user state pull for fresh installs
- [ ] Implement `SyncService.cs` — called by `sync.flush()`, POSTs outbox to Supabase
- [ ] Implement retry logic with exponential backoff in sync service
- [ ] Test: answer 20 questions offline → come online → verify all synced correctly
- [ ] Test: balance conflict (edit same user from two devices) → verify server wins

### Phase 4 — Content OTA (Week 4–5)

**Goal:** Content database versioning and swapping working end-to-end.

- [ ] Generate initial `content.db` bundles per subject/grade
- [ ] Set up CDN folder structure and `manifest.json`
- [ ] Write `contentVersionChecker.js` in React — checks manifest on boot
- [ ] Implement background download via `files.download()` bridge method
- [ ] Implement atomic swap logic in `FileService.cs`
- [ ] Write `safeContentSwap()` in React — flushes outbox before swapping
- [ ] Test: update manifest → app downloads new bundle → swap happens safely

### Phase 5 — Hardening (Week 5–6)

**Goal:** Edge cases covered, system is robust.

- [ ] Implement JWT expiry handling in sync service (refresh before every flush)
- [ ] Add capability discovery checks in React for all bridge calls
- [ ] Add `device.getInfo()` to capture `bridgeVersion` for analytics
- [ ] Implement event channel (`ManyaBackend.on()`) for native → React notifications
- [ ] Test: token expires mid-sync → verify graceful recovery, no data loss
- [ ] Test: content download interrupted → verify partial download cleaned up
- [ ] Load test: 500 pending sync_logs events → batch flush → verify all confirmed

---

## 14. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| User data loss during content swap | Medium | Critical | Always flush outbox before swap. Check zero pending before proceeding. |
| JWT token expires during sync | High | High | Refresh token at start of every flush cycle. Handle 401 by queuing retry. |
| Migration fails midway | Low | High | Wrap each migration in a transaction. Failed migration is rolled back, not partially applied. |
| Content bundle download corrupted | Medium | Medium | Verify SHA256 hash of downloaded file against manifest before swapping. |
| Offline for weeks — outbox grows large | Low | Medium | Batch flush in groups of 100. Never load all pending into memory at once. |
| Old bridge version + new React feature | High | Low | Capability check before every new feature. Show update prompt gracefully. |
| Supabase RPC processes event twice | Low | Medium | Each sync_log has a unique `id`. Supabase RPC uses `ON CONFLICT DO NOTHING`. |
| Network cuts mid-flush | High | Low | Events stay in outbox (synced_at is NULL). Retry on next flush. |

---

## 15. Glossary

| Term | Definition |
|---|---|
| **Bridge** | The `window.ManyaBackend` JavaScript object exposed by C# that React calls for I/O |
| **Outbox** | The `sync_logs` table — a queue of events waiting to be pushed to Supabase |
| **OTA** | Over-The-Air. A React app update delivered via the web server without a Play Store release |
| **content.db** | The read-only SQLite database containing all educational content (questions, vault items, etc.) |
| **user.db** | The read-write SQLite database containing all user-specific state (progress, balances, answers) |
| **Canonical state** | The server's authoritative version of user data. When in conflict, this wins |
| **Ledger accounting** | Storing balance changes as a log of transactions rather than updating a single balance field |
| **Capability discovery** | React checking `window.ManyaBackend.capabilities` before calling a bridge method |
| **Migration** | A versioned SQL script that evolves the `user.db` schema without replacing the database |
| **Atomic swap** | Replacing a file in a single operation so there is no moment where the file is partially written |
| **Event sourcing** | Recording what happened (events) rather than what the current state is (record updates) |

---

*This document is a living specification. When the architecture evolves, update this document before writing any code.*
