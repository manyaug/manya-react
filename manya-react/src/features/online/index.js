/**
 * ONLINE-REQUIRED FEATURES
 * ========================
 * All modules in this directory bypass SQLite and call Supabase directly.
 *
 * CONNECTIVITY CONTRACT:
 *   Every function in this directory MUST:
 *   1. Call deviceIsOnline() or check network status BEFORE making Supabase calls.
 *   2. Return a typed error { error: 'OFFLINE', message: '...' } if offline.
 *   3. NEVER write to sync_logs — these features do not have offline fallbacks.
 *
 * Features:
 *   - auth/     → Login, Signup, Forgot Password (Supabase Auth)
 *   - duels/    → P2P Duels, Real-time Matchmaking (Supabase Realtime + RPC)
 *   - rankings/ → Global & League Leaderboards (Supabase Views)
 *   - reports/  → Parent Report sending (Supabase Edge Functions + Twilio)
 *
 * UI Pattern: If a component imports from /online-features and deviceIsOnline()
 * returns false, display the <OfflineGate /> component instead of the feature.
 *
 * @see src/offline-features/README.md  for offline counterparts
 * @see src/backend/bridge/manyaBridge.js#deviceIsOnline
 */

export { default as OnlineGate } from './OnlineGate.jsx';
