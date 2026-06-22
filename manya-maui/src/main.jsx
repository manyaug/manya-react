/**
 * MANYA MAUI — App Entry Point
 * ============================
 * This replaces manya-react/src/main.jsx for the MAUI WebView build.
 *
 * Differences from the web version:
 *   1. Calls runMigrations() BEFORE React renders — ensures user.db has
 *      all required tables on first install (or after an app update).
 *   2. No service worker registration — MAUI WebView doesn't use SW.
 *   3. No legacy cache cleanup — not needed in a controlled WebView.
 *
 * The rest of the app (App.jsx, all views, engines, store) is shared
 * from manya-react/src via the @ alias in vite.config.js.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Shared app — imported from ../manya-react/src via Vite @ alias
import App from '@/App.jsx';
import '@/index.css';

// MAUI-only: bridge-aware migration runner
// Creates all user.db tables on first install, applies new migrations on update.
import { runMigrations } from '@/backend/db/migrationRunner.js';

// ── Boot Sequence ─────────────────────────────────────────────────────────────

async function bootstrap() {
    // Step 1: Ensure user.db schema is current before anything reads from it
    try {
        const result = await runMigrations();
        if (result && result.failed > 0) {
            console.error('[MAUI Boot] DB migration errors:', result.errors);
        } else {
            console.log('[MAUI Boot] DB migrations OK');
        }
    } catch (err) {
        // Non-fatal — app can still run on web fallback (IndexedDB)
        console.warn('[MAUI Boot] Migration runner error (non-fatal):', err?.message);
    }

    // Step 2: Render React app
    createRoot(document.getElementById('root')).render(
        <StrictMode>
            <App />
        </StrictMode>,
    );
}

bootstrap();
