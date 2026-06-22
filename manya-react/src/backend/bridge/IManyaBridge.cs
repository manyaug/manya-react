using System.Threading.Tasks;

namespace ManyaApp.Contracts
{
    /// <summary>
    /// IManyaBridge — The stable contract for the JavaScript ↔ C# bridge.
    /// This interface defines EVERY method that window.ManyaBackend exposes.
    ///
    /// RULES:
    ///   1. Methods NEVER use positional parameters — always use options objects.
    ///   2. New methods are ADDED only — existing signatures are never changed.
    ///   3. The bridge version is bumped with every new method added.
    ///   4. Capabilities array in JS is updated to match.
    ///
    /// Implementation: ManyaApp/Services/BridgeService.cs
    /// JS Contract:    src/backend/bridge/manyaBridge.js
    /// Bridge Version: 1.0.0
    /// </summary>
    public interface IManyaBridge
    {
        // ── Meta ────────────────────────────────────────────────────────────────
        string Version { get; }
        string[] Capabilities { get; }

        // ── Database ─────────────────────────────────────────────────────────────
        // db: "user" → user.db (READ-WRITE) | "content" → content.db (READ-ONLY)
        Task<string> DbQuery(string db, string table, string filterJson, string optionsJson);
        Task<string> DbUpsert(string db, string table, string dataJson);
        Task<string> DbDelete(string db, string table, string filterJson);
        Task<string> DbExecute(string db, string sql, string paramsJson);
        Task<string> DbTransaction(string db, string operationsJson);

        // ── File I/O ─────────────────────────────────────────────────────────────
        Task<string> FilesRead(string path, string optionsJson);
        Task<string> FilesWrite(string path, string data, string optionsJson);
        Task<string> FilesDelete(string path);
        Task<string> FilesList(string directory);
        Task<bool>   FilesExists(string path);
        Task<string> FilesDownload(string url, string localPath, string optionsJson);
        Task<string> FilesBasePath();

        // ── Sync ─────────────────────────────────────────────────────────────────
        Task<string> SyncFlush();
        Task<string> SyncStatus();

        // ── Auth ─────────────────────────────────────────────────────────────────
        Task<string> AuthGetSession();
        Task<string> AuthRefresh();
        Task         AuthSetSession(string accessToken, string refreshToken);
        Task         AuthClear();

        // ── Device ───────────────────────────────────────────────────────────────
        Task<string> DeviceGetInfo();
        Task<bool>   DeviceIsOnline();
        Task         DeviceNotify(string title, string body, string optionsJson);

        // ── Event Emission (C# → React via EvaluateJavascript) ───────────────────
        Task FireEvent(string eventName, string payloadJson);
    }
}
