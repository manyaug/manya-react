# Manya App — Full Session Summary
### Architecture, Decisions & Proposals

> **Session Date:** June 15, 2026  
> **Context:** Designing the offline-first MAUI + React hybrid architecture  

---

## What We Started With

The conversation began with a mapping exercise — matching Supabase tables and columns to the existing SQLite schema. The core problem uncovered was that the two databases were diverging: Supabase used PostgreSQL-specific types (`uuid`, `boolean`, `jsonb`, partitioned tables) that did not translate cleanly to SQLite, causing silent data inconsistencies and schema drift.

The user confirmed:
- No C# source code constraints — only the databases matter
- The MAUI app loads a React WebView and builds JavaScript bridges
- The React frontend can be refactored to match any naming changes
- Supabase partitioned tables (`manya_vault_english_g4`, etc.) can be dropped if it simplifies the architecture
- The goal is: **update the React app OTA without ever requiring a Play Store release, except for new native hardware features**

---

## The Core Problems Identified

| # | Problem | Impact |
|---|---|---|
| 1 | PostgreSQL types don't map to SQLite | Silent data corruption on sync |
| 2 | Supabase partitioned tables have no SQLite equivalent | Query routing breaks |
| 3 | No schema migration strategy for `user.db` | Any schema change risks user data loss |
| 4 | Monolithic SQLite file — content mixed with user state | Replacing schema = losing all user progress |
| 5 | JWT token can expire during offline → online sync | Outbox flush silently fails with 401 |
| 6 | Sync conflicts resolved by last-write-wins | Balance/streak data corrupted on multi-device |
| 7 | No contract between React and C# bridge | Bridge changes required for every new feature |
| 8 | Pre-seeded DB file could be 50-200MB+ | Slow download, expensive on mobile data |

---

## Decision 1 — Align Supabase Schema to SQLite (Not the Other Way Around)

### What Was Decided
Rather than writing complex type-conversion code in the sync layer, align the Supabase schema to match SQLite's native types. This makes both databases mirrors of each other with zero translation overhead.

### Changes to Supabase Schema

| PostgreSQL Type | Changed To | Reason |
|---|---|---|
| `uuid` primary keys | `TEXT` | SQLite stores UUIDs as plain text |
| `boolean` columns | `INTEGER (0/1)` | SQLite has no boolean type |
| `jsonb` columns | `TEXT` (serialized JSON) | SQLite has no JSON type |
| `timestamptz` | `TEXT` (ISO8601 string) | SQLite stores dates as text |
| `SERIAL` | `INTEGER PRIMARY KEY` | SQLite auto-increment syntax |
| Partitioned tables | Flat subject tables | SQLite has no partitioning concept |

### Dropped: PostgreSQL Table Partitions
Tables like `manya_vault_english_g4` are replaced with flat tables:
- `questions_math`, `questions_english`, `questions_science`, `questions_sst`
- `manya_vault_math`, `manya_vault_english`, `manya_vault_science`, `manya_vault_sst`

Grade filtering becomes a `WHERE grade_level = 4` clause instead of a table partition.

---

## Decision 2 — Split SQLite Into Two Databases

### The Mental Model

> **Content data and User data are fundamentally different things and must be treated differently.**

This is the same model used by Duolingo, Khan Academy, and every major offline-first EdTech app.

### `content.db` — Read-Only on Device

Stores everything that is the **same for all users** with the same grade.

| What lives here | Tables |
|---|---|
| All questions | `questions_math`, `questions_english`, `questions_science`, `questions_sst` |
| Vault definitions | `manya_vault_math`, `manya_vault_english`, etc. |
| Game structures | `challenges`, `quests`, `badges` |
| Version tracking | `content_version` |

- **Never written to by the app or user**
- **Safe to delete and re-download at any time**
- **Replaced atomically when a new version is available**

### `user.db` — Live Read/Write

Stores everything that **belongs to a specific user**.

| What lives here | Tables |
|---|---|
| Identity | `users` |
| Economy | `user_balances`, `user_transactions` |
| Activity | `user_answers`, `user_sessions` |
| Progress | `quest_progress`, `concept_mastery`, `user_streaks` |
| Rewards | `user_vault`, `user_badges` |
| Sync queue | `sync_logs` |
| DB tracking | `schema_version` |

- **Never replaced — only incrementally migrated**
- **Loss of this file = loss of all user progress**
- **The outbox (`sync_logs`) lives here**

---

## Decision 3 — Supabase Is One Project, Two Schemas

Supabase does **not** need two separate projects. One project with two PostgreSQL schemas achieves the same separation cleanly.

```
One Supabase Project
├── Schema: content      ← All content tables (managed by admin only)
└── Schema: public       ← All user tables (RLS-protected per user)
```

### Row Level Security

- **Content schema:** Authenticated users can `SELECT`. Only service role can `INSERT/UPDATE/DELETE`. Content is managed by your team, not users.
- **Public schema:** Users can only read and write rows where `user_id = auth.uid()`. No user can touch another user's data.

---

## Decision 4 — Flexible Content Delivery (No Vendor Lock-in)

### What Was Decided
Content bundles (the SQLite files for `content.db`) are hosted on **any server or CDN of your choice** — not locked to Supabase Storage. This keeps you flexible to switch hosting providers, use your own VPS, a GitHub release, Cloudflare R2, AWS S3, or any static file host.

### How It Works

A single `manifest.json` file (hosted anywhere) acts as the version registry:

```json
{
  "version": "2.1.4",
  "released_at": "2026-06-15T00:00:00Z",
  "bundles": [
    {
      "subject": "math",
      "grade": 4,
      "version": "2.1.4",
      "url": "https://files.manya.ug/content/math_g4_v2.1.4.sqlite",
      "sha256": "abc123..."
    },
    {
      "subject": "english",
      "grade": 4,
      "version": "2.0.1",
      "url": "https://files.manya.ug/content/english_g4_v2.0.1.sqlite",
      "sha256": "def456..."
    }
  ]
}
```

**The manifest URL is a configuration value in the React app.** Changing hosting providers means updating one URL string in the React app — no C# changes, no Play Store release.

### Download Rules
- Only download bundles relevant to **this user's grade** (not all grades)
- Only download bundles whose version **differs from what is locally installed**
- Verify the `sha256` hash of the downloaded file before swapping
- The swap only happens after the outbox is fully flushed (see Decision 6)

---

## Decision 5 — The Stable C# Bridge Contract

### The Principle
> The C# MAUI shell is a dumb infrastructure host. It exposes generic I/O primitives. All business logic lives in React.

The bridge is a fixed set of ~25 generic methods registered as `window.ManyaBackend`. Once written, it does not change for business logic updates. It only grows when new **native device hardware** is needed.

### The Full Bridge Surface

```
window.ManyaBackend
├── version           "1.0.0"
├── capabilities      ["db", "files", "sync", "auth", "device"]
│
├── db
│   ├── query(db, table, filter, options)       ← SELECT
│   ├── upsert(db, table, data)                 ← INSERT OR REPLACE
│   ├── delete(db, table, filter)               ← DELETE
│   ├── execute(db, sql, params)                ← Raw parameterized SQL
│   └── transaction(db, operations[])           ← Atomic batch
│
├── files
│   ├── read(path, options)
│   ├── write(path, data, options)
│   ├── delete(path)
│   ├── list(directory)
│   ├── exists(path)
│   ├── download(url, localPath, options)       ← Background download
│   └── basePath()                              ← Device storage root
│
├── sync
│   ├── flush()                                 ← Push outbox to Supabase
│   └── status()                               ← { pending, lastSync, isOnline }
│
├── auth
│   ├── getSession()
│   ├── refresh()
│   ├── setSession(access_token, refresh_token)
│   └── clear()
│
├── device
│   ├── getInfo()
│   ├── isOnline()
│   └── notify(title, body, options)
│
└── on(event, callback)                         ← Native → React event channel
    off(event, callback)
    Events: "syncComplete" | "networkChanged" | "downloadProgress" | "downloadComplete" | "authExpired"
```

### The Options Object Pattern

All methods take an **options object** as the last argument, never positional parameters. This ensures future options can be added without breaking existing callers.

```javascript
// ❌ Breaks when a 5th param is added
db.query("user", "users", filter, "created_at", 20)

// ✅ Future-proof — new options are ignored by old bridge
db.query("user", "users", filter, { orderBy: "created_at", limit: 20 })
```

### What Requires a C# (Play Store) Update vs What Doesn't

| Does NOT need C# update (OTA via React) | Needs C# update (Play Store) |
|---|---|
| New UI screens and features | Camera / photo upload |
| New database tables or columns | Microphone / audio recording |
| New question/vault/quest types | Biometric login |
| New sync logic or event types | Background sync (app closed) |
| New content version checks | Remote push notifications |
| Bug fixes in business logic | Native file picker |
| New grade levels or subjects | Deep link / URL scheme handling |
| Schema migrations | New hardware (Bluetooth, NFC) |

### Capability Discovery (Prevents Crashes on Old Bridge)

```javascript
// React OTA update adds a feature requiring camera
if (window.ManyaBackend.capabilities.includes('camera')) {
  await window.ManyaBackend.device.camera();
} else {
  // Graceful prompt — no crash
  showUpdatePrompt("Update the Manya app to unlock this feature");
}
```

Old bridge + new React = graceful degradation, not a crash.

---

## Decision 6 — Outbox Pattern for Sync (Offline-First)

### The Write Path (Always Works Offline)

```
User does something (answers a question, completes a quest, unlocks a vault item)
  ↓
Write to user.db immediately         ← No network wait
  ↓
Append typed event to sync_logs      ← Queue for later
  ↓
Update UI optimistically             ← Instant feedback
```

### The Sync Path (Background, When Online)

```
Background sync wakes up
  ↓
Refresh JWT token first (prevents silent 401 failures)
  ↓
Read all unsynced events from sync_logs (in batches of 100)
  ↓
POST batch to Supabase RPC: process_sync_batch()
  ↓
Server processes events, returns canonical state
  ↓
Mark events as synced_at = now()
  ↓
Update local balances from server's canonical response (server wins)
```

### Conflict Resolution Rules

| Data | Rule | Why |
|---|---|---|
| Coins / Gems / XP | Server ledger — `SUM(transactions)` | Prevents double-spend |
| Streak | Server wins (MAX date) | Prevents rewind |
| Mastery score | Server wins (MAX score) | Never lower a mastery score |
| Answers | Append-only, no conflict | Historical record |
| User profile | `updated_at` timestamp wins | Last-write wins |
| Vault items / Badges | Union (never remove) | Never revoke earned rewards |

### Critical Rule: Flush Before Content Swap

Before replacing `content.db` with a new version, the app **must**:
1. Call `sync.flush()` and confirm zero failures
2. Verify `sync_logs WHERE synced_at IS NULL` = 0 rows
3. Only then perform the atomic file swap

If the device is offline when a new content version is detected, the swap is **deferred** until the next online session after a successful flush.

---

## Decision 7 — Schema Migrations for user.db

`user.db` is never replaced. Schema changes are applied incrementally using versioned migrations. The React app ships its own migration list and runs them at boot.

### How It Works

```javascript
// migrations.js — shipped with React app, updated OTA
export const MIGRATIONS = [
  { version: 1, description: "Initial schema", sql: `CREATE TABLE IF NOT EXISTS users (...)` },
  { version: 2, description: "Add weekly_xp",  sql: `ALTER TABLE user_balances ADD COLUMN weekly_xp INTEGER DEFAULT 0` },
  { version: 3, description: "Add mastery",     sql: `CREATE TABLE IF NOT EXISTS concept_mastery (...)` },
  // New entries appended here — never edit existing ones
];

// migrationRunner.js — runs on every boot
async function runMigrations() {
  const current = await db.execute("user", "SELECT MAX(version) as v FROM schema_version", []);
  const pending = MIGRATIONS.filter(m => m.version > (current.rows[0]?.v ?? 0));
  for (const m of pending) {
    await db.transaction("user", [
      { op: "execute", sql: m.sql },
      { op: "upsert", table: "schema_version", data: { version: m.version, ... } }
    ]);
  }
}
```

**Rules:**
- Never edit a migration that has already been released
- Only append new migrations at the end
- Migrations always run inside a transaction — partial application is impossible

---

## What Changes in the React Webapp

### New Files Required

| File | Purpose |
|---|---|
| `src/backend/db/migrations.js` | Ordered list of all schema migration scripts |
| `src/backend/db/migrationRunner.js` | Runs pending migrations on boot via bridge |
| `src/backend/content/contentVersionChecker.js` | Fetches manifest, triggers background bundle downloads |
| `src/backend/bridge/manyaBackend.js` | Browser fallback wrapper (direct Supabase when no bridge) |

### Modified Files

| File | What Changes |
|---|---|
| `storageFacade.js` | Add `queryContent()` routing to `content.db` or Supabase `content` schema. Rename `queryUser()` and `upsertUser()` to be schema-aware. |
| `syncService.js` | Restrict outbox to user tables only. Add JWT refresh before every flush. Add retry with exponential backoff. Remove direct content table syncing. |
| `manyaDB.js` | Update all method calls to use new `window.ManyaBackend` API surface. |
| Every component that queries Supabase | Replace `.from('questions_math')` with `storage.queryContent('questions_math', ...)`. Replace direct upserts with `storage.upsertUser(...)`. |

### Boot Sequence (React manages everything)

```
App opens → WebView loads React (latest OTA version)
  ↓
runMigrations()          ← Apply any new schema changes to user.db
  ↓
checkContentVersion()    ← Compare manifest to local content_version (non-blocking)
  ↓
auth.getSession()        ← Load stored JWT from C# secure storage
  ↓
sync.flush()             ← Push any pending outbox events to Supabase
  ↓
App ready for use        ← Content downloads happen quietly in background
```

---

## Architecture at a Glance

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         MANYA ANDROID APP                               │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                    REACT WEBAPP (WebView)                         │  │
│  │                                                                   │  │
│  │  storageFacade.js   syncService.js   contentVersionChecker.js    │  │
│  │         │                 │                     │                 │  │
│  └─────────┼─────────────────┼─────────────────────┼─────────────────┘  │
│            │ window.ManyaBackend (stable bridge contract)               │
│  ┌─────────┼─────────────────┼─────────────────────┼─────────────────┐  │
│  │    C# Bridge             │                     │                  │  │
│  │  db.*   files.*   sync.flush()   auth.*   device.*               │  │
│  │    │         │           │                                        │  │
│  │    ▼         ▼           ▼                                        │  │
│  │ content.db  files    user.db                                      │  │
│  │ (read-only) (I/O)    (read/write)                                 │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
          ↑ sync.flush()              ↑ files.download()
          │                          │
┌─────────┴──────────────┐  ┌────────┴──────────────────────────────────┐
│   SUPABASE (Cloud)     │  │   CONTENT CDN (Any host — flexible)       │
│                        │  │                                           │
│  Schema: public        │  │   manifest.json   (version registry)     │
│  (user data + RLS)     │  │   bundles/                               │
│                        │  │   ├── math_g4_v2.1.4.sqlite              │
│  Schema: content       │  │   ├── english_g4_v2.1.4.sqlite           │
│  (read-only for users) │  │   └── ...                                │
└────────────────────────┘  └───────────────────────────────────────────┘
```

---

## Key Principles (Reference Card)

| # | Principle | One-liner |
|---|---|---|
| 1 | Content ≠ User Data | Never store questions and user progress in the same database |
| 2 | OTA-first | Every feature addition deployable without a Play Store update |
| 3 | Offline-first | Write locally first. Cloud sync is always background |
| 4 | Server is authoritative | For conflicts, server wins. Client sends events, not state |
| 5 | Stable bridge surface | C# exposes generic primitives, never app-specific logic |
| 6 | Additive-only migrations | New columns added, old columns never renamed or deleted |
| 7 | Graceful degradation | Old bridge + new React = prompt, not crash |
| 8 | Flexible delivery | Content CDN is any URL — no vendor lock-in |
| 9 | Flush before swap | Never replace content.db while outbox has pending events |
| 10 | Ledger accounting | Balances stored as transaction log, not a mutable number |
