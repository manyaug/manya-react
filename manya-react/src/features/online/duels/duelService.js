/**
 * P2P Duels Feature — ONLINE-REQUIRED
 * =====================================
 * @online-only  Real-time matchmaking and duel execution require active internet.
 *
 * Duel flow (Online → Offline sync):
 *   1. [Online]  Challenger finds opponent via Supabase presence/matchmaking RPC.
 *   2. [Online]  Duel created in Supabase (quiz_duels table).
 *   3. [Online]  Both players answer questions via Realtime channel.
 *   4. [Online]  Supabase Edge Function resolves winner, updates user_balances.
 *   5. [Bridge]  React calls queueSyncEvent('DUEL_RESOLVED', { duelId, winnerId })
 *   6. [Offline] Next sync flush pulls canonical balances — user_balances updated locally.
 *
 * If device goes OFFLINE mid-duel: duel is abandoned via disqualify_abandoned_duel.sql logic.
 */

// @online-only
import { createClient } from '@supabase/supabase-js';
import { deviceIsOnline, authRefresh, authGetSession } from '../../backend/bridge/manyaBridge.js';
import { queueSyncEvent } from '../../backend/sync/syncService.js';

const supabase = createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY
);

const OFFLINE_ERROR = { error: 'OFFLINE', message: 'Duels require an active internet connection.' };

/**
 * Find an opponent for a duel.
 * @param {{ subject: string, gradeLevel: string, wagerCurrency: 'coins'|'gems', wagerAmount: number }} options
 * @returns {Promise<{ duelId: string, opponent: object } | { error: string }>}
 */
export async function findDuelOpponent({ subject, gradeLevel, wagerCurrency, wagerAmount }) {
    if (!(await deviceIsOnline())) return OFFLINE_ERROR;

    const session = await authRefresh();
    if (!session?.access_token) return { error: 'AUTH_REQUIRED', message: 'Please log in to duel.' };

    const { data, error } = await supabase.rpc('find_duel_opponent', {
        p_subject:         subject,
        p_grade_level:     gradeLevel,
        p_wager_currency:  wagerCurrency,
        p_wager_amount:    wagerAmount
    });

    if (error) return { error: error.code, message: error.message };
    return data;
}

/**
 * Subscribe to real-time duel updates.
 * @param {string} duelId
 * @param {{ onUpdate: Function, onComplete: Function }} handlers
 * @returns {{ unsubscribe: Function }} — call unsubscribe() when component unmounts
 */
export function subscribeToDuel(duelId, { onUpdate, onComplete }) {
    const channel = supabase
        .channel(`duel:${duelId}`)
        .on('postgres_changes', {
            event:  'UPDATE',
            schema: 'public',
            table:  'quiz_duels',
            filter: `id=eq.${duelId}`
        }, (payload) => {
            const duel = payload.new;
            if (duel.status === 'completed' || duel.status === 'abandoned') {
                onComplete?.(duel);
            } else {
                onUpdate?.(duel);
            }
        })
        .subscribe();

    return {
        unsubscribe: () => supabase.removeChannel(channel)
    };
}

/**
 * Submit a player's duel answers. Called when a player finishes their questions.
 * @param {string} duelId
 * @param {{ score: number, timeSpentMs: number, answers: object[] }} results
 */
export async function submitDuelAnswers(duelId, results) {
    if (!(await deviceIsOnline())) {
        // Queue for later — duel will be resolved server-side when we reconnect
        await queueSyncEvent('DUEL_ANSWER_SUBMITTED', { duelId, ...results });
        return { queued: true };
    }

    const session = await authGetSession();
    const { data, error } = await supabase
        .from('quiz_duel_participants')
        .upsert({
            duel_id:      duelId,
            user_id:      session?.user_id,
            score:        results.score,
            time_spent_ms: results.timeSpentMs,
            answers:      JSON.stringify(results.answers),
            completed_at: new Date().toISOString()
        });

    if (error) return { error: error.message };

    // Queue a sync event so local balances update when server resolves
    await queueSyncEvent('DUEL_ANSWER_SUBMITTED', { duelId, ...results });
    return { submitted: true };
}

/**
 * Fetch the Global Leaderboard — ONLINE-REQUIRED.
 * @param {{ gradeLevel: string, limit?: number }} options
 */
export async function getGlobalLeaderboard({ gradeLevel, limit = 50 }) {
    if (!(await deviceIsOnline())) return OFFLINE_ERROR;

    const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_url, weekly_xp, league, grade_level')
        .eq('grade_level', gradeLevel)
        .order('weekly_xp', { ascending: false })
        .limit(limit);

    if (error) return { error: error.message };
    return { leaderboard: data };
}

/**
 * Fetch League Leaderboard — ONLINE-REQUIRED.
 * @param {{ cohortId: string }} options
 */
export async function getLeagueLeaderboard({ cohortId }) {
    if (!(await deviceIsOnline())) return OFFLINE_ERROR;

    const { data, error } = await supabase.rpc('get_manya_rankings', { p_cohort_id: cohortId });
    if (error) return { error: error.message };
    return { leaderboard: data };
}
