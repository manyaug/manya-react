using Microsoft.Maui.Storage;
using SQLite;
using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading.Tasks;

namespace ManyaApp.Data
{
    /// <summary>
    /// DbRouter — Routes 'user' / 'content' database identifiers to the correct SQLite file.
    ///
    /// The React app calls ManyaBackend.db.query('user', ...) or ManyaBackend.db.query('content', ...).
    /// This router translates those string identifiers to the correct on-device SQLite file path
    /// and enforces the READ-ONLY rule on content.db.
    ///
    /// File locations:
    ///   user.db    → FileSystem.AppDataDirectory/user.db    (READ-WRITE)
    ///   content.db → FileSystem.AppDataDirectory/content.db (READ-ONLY — enforced here)
    /// </summary>
    public class DbRouter : IDisposable
    {
        private SQLiteAsyncConnection? _userDb;
        private SQLiteAsyncConnection? _contentDb;

        private static readonly string UserDbPath =
            System.IO.Path.Combine(FileSystem.AppDataDirectory, "user.db");

        private static readonly string ContentDbPath =
            System.IO.Path.Combine(FileSystem.AppDataDirectory, "content.db");

        // ── Connection Management ─────────────────────────────────────────────

        public async Task<SQLiteAsyncConnection> GetConnection(string db)
        {
            return db.ToLowerInvariant() switch
            {
                "user"    => await GetUserDb(),
                "content" => await GetContentDb(),
                _ => throw new ArgumentException($"Unknown database identifier: '{db}'. Must be 'user' or 'content'.")
            };
        }

        private async Task<SQLiteAsyncConnection> GetUserDb()
        {
            if (_userDb == null)
            {
                _userDb = new SQLiteAsyncConnection(UserDbPath, SQLiteOpenFlags.ReadWrite | SQLiteOpenFlags.Create);
                await EnsureUserDbInitialized();
            }
            return _userDb;
        }

        private async Task<SQLiteAsyncConnection> GetContentDb()
        {
            if (_contentDb == null)
            {
                // content.db is opened READ-ONLY. This prevents any accidental writes.
                _contentDb = new SQLiteAsyncConnection(ContentDbPath, SQLiteOpenFlags.ReadOnly);
            }
            return _contentDb;
        }

        private async Task EnsureUserDbInitialized()
        {
            // schema_version table is the canary — if it doesn't exist, user.db is fresh.
            // React's migrationRunner.js handles the actual schema creation via DbExecute calls.
            await _userDb!.ExecuteAsync(
                @"CREATE TABLE IF NOT EXISTS schema_version (
                    version     INTEGER PRIMARY KEY,
                    applied_at  TEXT NOT NULL,
                    description TEXT
                )"
            );
        }

        // ── Content DB: Copy seed file on first install ───────────────────────

        /// <summary>
        /// On first install, copies the bundled content.db seed from app resources.
        /// Should be called once during app startup before GetContentDb() is called.
        /// </summary>
        public static async Task EnsureContentDbExists()
        {
            if (!System.IO.File.Exists(ContentDbPath))
            {
                // Copy the seed content.db bundled with the app package
                using var seedStream = await FileSystem.OpenAppPackageFileAsync("seed/content_v1.0.0.sqlite");
                using var destStream = System.IO.File.Create(ContentDbPath);
                await seedStream.CopyToAsync(destStream);
            }
        }

        // ── Write Guard ───────────────────────────────────────────────────────

        /// <summary>
        /// Validates that a write operation is not being attempted on content.db.
        /// Throws InvalidOperationException if violated.
        /// </summary>
        public static void AssertWritable(string db)
        {
            if (db.ToLowerInvariant() == "content")
            {
                throw new InvalidOperationException(
                    "content.db is READ-ONLY. User state may not be written to the content database. " +
                    "Write to 'user' database instead.");
            }
        }

        // ── Atomic Content DB Swap ────────────────────────────────────────────

        /// <summary>
        /// Atomically replaces content.db with a newly downloaded bundle.
        /// Closes the existing connection before swapping.
        ///
        /// Called by FileService.cs when a content download completes and
        /// React's syncService.safeContentSwap() confirms the outbox is empty.
        /// </summary>
        /// <param name="newFilePath">Path to the newly downloaded SQLite file.</param>
        public async Task SwapContentDb(string newFilePath)
        {
            // Close existing connection
            if (_contentDb != null)
            {
                await _contentDb.CloseAsync();
                _contentDb = null;
            }

            // Atomic rename (same volume = rename, not copy)
            System.IO.File.Move(newFilePath, ContentDbPath, overwrite: true);

            // Re-open
            await GetContentDb();
        }

        public void Dispose()
        {
            _userDb?.CloseAsync().GetAwaiter().GetResult();
            _contentDb?.CloseAsync().GetAwaiter().GetResult();
        }
    }
}
