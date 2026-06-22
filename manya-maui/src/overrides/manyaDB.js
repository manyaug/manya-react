/**
 * MANYA LOCAL DATABASE — MAUI OVERRIDE
 * =====================================
 * This replaces manya-react/src/backend/db/manyaDB.js
 * when building for MAUI.
 *
 * It uses the manyaBridge.js typed API to talk to the SQLite db
 * managed by C#.
 */

import { dbQuery, dbUpsert, dbDelete, dbExecute } from '@/backend/bridge/manyaBridge.js';

export const ManyaDB = {
    DB_NAME: 'ManyaSystemDB', // Kept for interface compat
    VERSION: 5,
    
    // Kept for interface compat, though we use bridge table names
    STORE_USERS: 'profiles', // mapped to profiles in SQLite schema
    STORE_QUESTIONS: 'questions',
    STORE_SYNC_LOGS: 'sync_logs',
    STORE_ANSWERS: 'user_answers',
    STORE_CONCEPT_MASTERY: 'concept_mastery',

    async connect() {
        // SQLite is always ready over the bridge
        return true;
    },

    // ── USERS ─────────────────────────────────────────────────────────────────
    async getCurrentUser() {
        const uid = localStorage.getItem('manya_session_id');
        if (!uid) return null;
        
        try {
            const raw = await dbQuery('user', 'profiles', { id: uid }, { limit: 1 });
            const rows = typeof raw === 'string' ? JSON.parse(raw) : raw;
            return rows && rows.length > 0 ? rows[0] : null;
        } catch {
            return null;
        }
    },

    async saveUser(userData) {
        if (userData.id && userData.id !== 'null' && userData.id !== 'undefined') {
            localStorage.setItem('manya_session_id', userData.id);
        } else if (userData.uid && userData.uid !== 'null' && userData.uid !== 'undefined') {
            // Legacy compat
            localStorage.setItem('manya_session_id', userData.uid);
            userData.id = userData.uid; // normalize for SQLite 'profiles' table
        }
        
        try {
            // Drop non-schema keys if any, or let SQLite mapper handle it
            await dbUpsert('user', 'profiles', userData);
            return true;
        } catch (e) {
            console.error('[MAUI DB] saveUser error:', e);
            return false;
        }
    },

    // ── QUESTIONS CACHE (content.db) ──────────────────────────────────────────
    async getCachedQuestions(subject, topic = null) {
        try {
            const filter = { subject };
            if (topic) filter.topic = topic;
            
            const raw = await dbQuery('content', 'questions', filter);
            return typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch {
            return [];
        }
    },

    async cacheQuestions(questions) {
        if (!questions || !Array.isArray(questions)) return false;
        const validQuestions = questions.filter(q => q && (q.qid || q.id));
        
        try {
            // MAUI bridge doesn't have a bulkUpsert yet, use transaction or loop
            const ops = validQuestions.map(q => ({
                op: 'upsert',
                table: 'questions',
                data: q
            }));
            
            // Using transaction for bulk
            await import('@/backend/bridge/manyaBridge.js').then(m => m.dbTransaction('content', ops));
            return true;
        } catch (e) {
            console.error('[MAUI DB] cacheQuestions error:', e);
            return false;
        }
    },

    async clearQuestionCache() {
        try {
            await dbExecute('content', 'DELETE FROM questions');
        } catch (e) {
            console.error('[MAUI DB] clearQuestionCache error:', e);
        }
    },

    // ── SYNC QUEUE (Offline Write Buffer) ─────────────────────────────────────
    async addToSyncQueue(type, data) {
        try {
            const payload = typeof data === 'string' ? data : JSON.stringify(data);
            const entry = { 
                event_type: type, 
                payload: payload, 
                created_at: new Date().toISOString(),
                synced_at: null,
                retry_count: 0
            };
            await dbUpsert('user', 'sync_logs', entry);
            return true;
        } catch (e) {
            console.error('[MAUI DB] addToSyncQueue error:', e);
            return false;
        }
    },

    async getSyncQueue() {
        try {
            // Need to filter where synced_at IS NULL. Our basic filter might only do equality.
            // Using raw execute to be safe.
            const raw = await dbExecute('user', 'SELECT * FROM sync_logs WHERE synced_at IS NULL');
            const res = typeof raw === 'string' ? JSON.parse(raw) : raw;
            return res.rows || [];
        } catch {
            return [];
        }
    },

    async removeSyncItem(id) {
        try {
            await dbDelete('user', 'sync_logs', { id });
            return true;
        } catch {
            return false;
        }
    },

    // ── ANSWER HISTORY ────────────────────────────────────────────────────────
    async getAnswerHistory(subject) {
        try {
            const raw = await dbQuery('user', 'user_answers', { subject }, { limit: 500, orderBy: 'id', orderDir: 'desc' });
            const rows = typeof raw === 'string' ? JSON.parse(raw) : raw;
            return rows || [];
        } catch {
            return [];
        }
    },

    async recordAnswer(subject, answerData) {
        try {
            const entry = { ...answerData, subject, answered_at: new Date().toISOString() };
            // Ensure ID is set or let SQLite autoincrement
            if (!entry.id) {
                entry.id = crypto.randomUUID();
            }
            await dbUpsert('user', 'user_answers', entry);
            return true;
        } catch (e) {
            console.error('[MAUI DB] recordAnswer error:', e);
            return false;
        }
    },

    // ── CONCEPT MASTERY ───────────────────────────────────────────────────────
    async getConceptMastery(subject, baseId) {
        try {
            const raw = await dbQuery('user', 'concept_mastery', { id: `${subject}::${baseId}` }, { limit: 1 });
            const rows = typeof raw === 'string' ? JSON.parse(raw) : raw;
            return rows && rows.length > 0 ? rows[0] : null;
        } catch {
            return null;
        }
    },

    async upsertConceptMastery(record) {
        try {
            await dbUpsert('user', 'concept_mastery', record);
            return true;
        } catch {
            return false;
        }
    },

    async getAllConceptMastery(subject) {
        try {
            const raw = await dbQuery('user', 'concept_mastery', { subject });
            const rows = typeof raw === 'string' ? JSON.parse(raw) : raw;
            return rows || [];
        } catch {
            return [];
        }
    },

    // ── DEFAULT USER TEMPLATE ─────────────────────────────────────────────────
    createDefaultRecord() {
        return {
            id: null, email: null, onboarded: 0,
            nickname: 'New Hero', full_name: '', avatar_seed: 'Manya',
            diamonds: 0, coins: 0,
            math_gems: 0, science_gems: 0, english_gems: 0, sst_gems: 0,
            current_streak: 0, longest_streak: 0, last_active_at: null,
            unlocked_badges: '["gen_01"]',
            stats_quests_completed: 0, stats_perfect_answers: 0,
            stats_hints_used: 0, stats_explanations_viewed: 0,
            theme: 'dark',
            preferences: '{"likes":[],"hates":[]}',
            parent: '{"name":"","whatsapp":""}',
            report_enabled: 1,
            pending_badge_celebrations: '[]',
            vault_artifacts: '[]',
            is_pro: 0,
            learning_type: 'ADAPTIVE',
            created_at: new Date().toISOString(),
            math_correct: 0, science_correct: 0, english_correct: 0, sst_correct: 0
        };
    }
};
