/**
 * Auth Feature — ONLINE-REQUIRED
 * ================================
 * @online-only  Login, Signup, Forgot Password — all require active internet.
 *
 * Auth flow:
 *   1. User fills in credentials in React UI.
 *   2. React calls Supabase Auth directly (online).
 *   3. On success, React calls authSetSession(access_token, refresh_token).
 *   4. C# stores tokens in SecureStorage.
 *   5. Sync service uses stored tokens for all future outbox flushes.
 *
 * If device is OFFLINE: show offline message — do NOT try to authenticate.
 */

// @online-only
import { createClient } from '@supabase/supabase-js';
import { authSetSession, authClear, deviceIsOnline } from '../../backend/bridge/manyaBridge.js';

const supabase = createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY
);

const OFFLINE_ERROR = { error: 'OFFLINE', message: 'This feature requires an internet connection.' };

/**
 * Login with email and password.
 * On success, persists JWT to C# SecureStorage via the bridge.
 *
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{ user, session } | { error: string, message: string }>}
 */
export async function login(email, password) {
    if (!(await deviceIsOnline())) return OFFLINE_ERROR;

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.code, message: error.message };

    // AUTH BRIDGE: Pass JWT to C# SecureStorage for offline sync use
    await authSetSession(data.session.access_token, data.session.refresh_token);

    return { user: data.user, session: data.session };
}

/**
 * Sign up a new user.
 * @param {string} email
 * @param {string} password
 * @param {{ fullName: string, gradeLevel: string }} metadata
 */
export async function signup(email, password, metadata = {}) {
    if (!(await deviceIsOnline())) return OFFLINE_ERROR;

    const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: metadata }
    });
    if (error) return { error: error.code, message: error.message };

    if (data.session) {
        // User confirmed immediately (email confirmation disabled)
        await authSetSession(data.session.access_token, data.session.refresh_token);
    }

    return { user: data.user, session: data.session };
}

/**
 * Send a password reset email.
 * @param {string} email
 */
export async function forgotPassword(email) {
    if (!(await deviceIsOnline())) return OFFLINE_ERROR;

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${import.meta.env.VITE_APP_URL}/reset-password`
    });
    if (error) return { error: error.code, message: error.message };
    return { success: true };
}

/**
 * Sign out — clears tokens from C# SecureStorage and Supabase session.
 */
export async function logout() {
    await authClear();        // Clear from C# SecureStorage
    await supabase.auth.signOut();
    return { success: true };
}
