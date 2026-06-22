/**
 * Schema Migrations — user.db
 * ============================
 * Each migration is a versioned SQL block.
 * RULES:
 *   1. NEVER edit a migration that has already been released.
 *   2. Always ADD new migrations at the end.
 *   3. Wrap each migration sql in IF NOT EXISTS / additive-only ALTER TABLE.
 *   4. Never DROP or RENAME columns.
 *
 * @see migrationRunner.js  for the runner that applies these on every boot.
 */

export const MIGRATIONS = [
    {
        version: 1,
        description: 'Initial user.db schema — all tables from sqlite_user_schema.sql',
        sql: `
            CREATE TABLE IF NOT EXISTS schema_version (
                version     INTEGER PRIMARY KEY,
                applied_at  TEXT NOT NULL,
                description TEXT
            );

            CREATE TABLE IF NOT EXISTS profiles (
                id TEXT PRIMARY KEY, full_name TEXT, grade_level TEXT,
                is_pro INTEGER DEFAULT 0, avatar_url TEXT, preferences TEXT,
                parent_email TEXT, parent_phone TEXT, last_active_at TEXT,
                created_at TEXT, learning_type TEXT, current_streak INTEGER DEFAULT 0,
                longest_streak INTEGER DEFAULT 0, challenge_day INTEGER DEFAULT 0,
                parent_name TEXT, parent_whatsapp TEXT, parent_pin_hash TEXT,
                report_enabled INTEGER DEFAULT 1, report_frequency TEXT,
                last_report_sent TEXT, math_correct INTEGER DEFAULT 0,
                science_correct INTEGER DEFAULT 0, english_correct INTEGER DEFAULT 0,
                sst_correct INTEGER DEFAULT 0, unlocked_badges TEXT DEFAULT '[]',
                onboarded INTEGER DEFAULT 0, league TEXT DEFAULT 'bronze',
                weekly_xp INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS user_balances (
                user_id TEXT PRIMARY KEY, coins INTEGER DEFAULT 0,
                gem_overall INTEGER DEFAULT 0, gem_math INTEGER DEFAULT 0,
                gem_science INTEGER DEFAULT 0, gem_english INTEGER DEFAULT 0,
                gem_sst INTEGER DEFAULT 0, updated_at TEXT
            );

            CREATE TABLE IF NOT EXISTS user_transactions (
                id TEXT PRIMARY KEY, user_id TEXT, currency TEXT NOT NULL,
                amount_change INTEGER NOT NULL, transaction_type TEXT,
                context_id TEXT, created_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_user_transactions_user_id ON user_transactions (user_id);
            CREATE INDEX IF NOT EXISTS idx_user_transactions_created_at ON user_transactions (created_at);

            CREATE TABLE IF NOT EXISTS user_answers (
                id TEXT PRIMARY KEY, user_id TEXT NOT NULL, question_id TEXT NOT NULL,
                is_correct INTEGER NOT NULL DEFAULT 0, selected_answer TEXT, correct_answer TEXT,
                time_spent_ms INTEGER NOT NULL DEFAULT 0, hint_used INTEGER DEFAULT 0,
                hint_level INTEGER, answer_changed INTEGER DEFAULT 0, answer_history TEXT,
                option_hover_times TEXT, confidence_rating INTEGER, tab_switched INTEGER DEFAULT 0,
                idle_time_ms INTEGER, time_to_first_click_ms INTEGER, hesitation_count INTEGER,
                reaction_emoji TEXT, frustration_clicks INTEGER, self_reported_difficulty INTEGER,
                session_id TEXT, session_question_number INTEGER, device_type TEXT,
                network_type TEXT, time_of_day TEXT, day_of_week TEXT, quest_id TEXT,
                quest_question_number INTEGER, points_earned INTEGER, streak_at_time INTEGER,
                answered_at TEXT, client_timestamp TEXT, synced INTEGER DEFAULT 0,
                frustration_level INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_user_answers_user_id ON user_answers (user_id);
            CREATE INDEX IF NOT EXISTS idx_user_answers_session_id ON user_answers (session_id);
            CREATE INDEX IF NOT EXISTS idx_user_answers_synced ON user_answers (synced);

            CREATE TABLE IF NOT EXISTS user_sessions (
                session_id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
                current_quest_id INTEGER, quest_questions TEXT, quest_results TEXT,
                question_history TEXT, frustration_level INTEGER, mastery_level TEXT,
                session_start TEXT, last_active TEXT, ended_at TEXT,
                confidence_rating INTEGER, engagement_level INTEGER, cognitive_load INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions (user_id);

            CREATE TABLE IF NOT EXISTS concept_mastery (
                id TEXT PRIMARY KEY, user_id TEXT NOT NULL, subject TEXT NOT NULL,
                base_id TEXT NOT NULL, mastery_level TEXT DEFAULT 'new',
                correct_streak INTEGER DEFAULT 0, total_attempts INTEGER DEFAULT 0,
                total_correct INTEGER DEFAULT 0, next_review_at TEXT, updated_at TEXT,
                review_count INTEGER DEFAULT 0, last_reviewed_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_concept_mastery_user_id ON concept_mastery (user_id);
            CREATE INDEX IF NOT EXISTS idx_concept_mastery_subject ON concept_mastery (subject);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_concept_mastery_unique ON concept_mastery (user_id, subject, base_id);

            CREATE TABLE IF NOT EXISTS concept_error_tracking (
                id TEXT PRIMARY KEY, user_id TEXT NOT NULL, subtopic TEXT NOT NULL,
                error_count INTEGER DEFAULT 0, last_question_id TEXT, updated_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_concept_error_tracking_user_id ON concept_error_tracking (user_id);

            CREATE TABLE IF NOT EXISTS quest_progress (
                id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL,
                quest_key TEXT NOT NULL, node_type TEXT NOT NULL,
                mastery INTEGER DEFAULT 0, status TEXT DEFAULT 'locked',
                attempts INTEGER DEFAULT 0, last_attempted_at TEXT,
                unlocked_at TEXT, streak_broken_at TEXT, stars INTEGER DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_quest_progress_user_id ON quest_progress (user_id);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_quest_progress_unique ON quest_progress (user_id, quest_key);

            CREATE TABLE IF NOT EXISTS user_challenges (
                id TEXT PRIMARY KEY, user_id TEXT NOT NULL, challenge_id TEXT NOT NULL,
                current_value INTEGER DEFAULT 0, is_completed INTEGER DEFAULT 0,
                completed_at TEXT, last_updated_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_user_challenges_user_id ON user_challenges (user_id);

            CREATE TABLE IF NOT EXISTS badges (
                id TEXT PRIMARY KEY, user_id TEXT NOT NULL, badge_type TEXT,
                badge_name TEXT, badge_icon TEXT, rarity TEXT, earned_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_badges_user_id ON badges (user_id);

            CREATE TABLE IF NOT EXISTS user_vault (
                id TEXT PRIMARY KEY, user_id TEXT, artifact_id TEXT NOT NULL,
                subject TEXT NOT NULL, unlocked_at TEXT, title TEXT,
                item_type TEXT, engine_type TEXT, cdn_url TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_user_vault_user_id ON user_vault (user_id);
            CREATE INDEX IF NOT EXISTS idx_user_vault_subject ON user_vault (subject);

            CREATE TABLE IF NOT EXISTS user_chests (
                id TEXT PRIMARY KEY, user_id TEXT NOT NULL, chest_type TEXT NOT NULL,
                opened INTEGER DEFAULT 0, created_at TEXT, opened_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_user_chests_user_id ON user_chests (user_id);

            CREATE TABLE IF NOT EXISTS power_ups (
                id TEXT PRIMARY KEY, user_id TEXT NOT NULL, power_up_type TEXT NOT NULL,
                quantity INTEGER DEFAULT 0, acquired_at TEXT, expires_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_power_ups_user_id ON power_ups (user_id);

            CREATE TABLE IF NOT EXISTS emotional_metrics (
                id TEXT PRIMARY KEY, user_id TEXT NOT NULL, session_id TEXT,
                emotion TEXT, intensity INTEGER, context TEXT,
                recorded_at TEXT, response_time_ms INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_emotional_metrics_user_id ON emotional_metrics (user_id);

            CREATE TABLE IF NOT EXISTS weekly_user_stats (
                user_id TEXT PRIMARY KEY, nickname TEXT, parent_name TEXT,
                parent_whatsapp TEXT, report_enabled INTEGER DEFAULT 0,
                last_report_sent TEXT, current_streak INTEGER DEFAULT 0,
                longest_streak INTEGER DEFAULT 0, week_start TEXT, week_end TEXT,
                total_time_ms INTEGER DEFAULT 0, total_questions INTEGER DEFAULT 0,
                total_correct INTEGER DEFAULT 0, accuracy_pct REAL DEFAULT 0.0,
                math_total INTEGER DEFAULT 0, math_correct_week INTEGER DEFAULT 0,
                math_time_ms INTEGER DEFAULT 0, science_total INTEGER DEFAULT 0,
                science_correct_week INTEGER DEFAULT 0, science_time_ms INTEGER DEFAULT 0,
                english_total INTEGER DEFAULT 0, english_correct_week INTEGER DEFAULT 0,
                english_time_ms INTEGER DEFAULT 0, sst_total INTEGER DEFAULT 0,
                sst_correct_week INTEGER DEFAULT 0, sst_time_ms INTEGER DEFAULT 0,
                coins INTEGER DEFAULT 0, gem_math INTEGER DEFAULT 0,
                gem_science INTEGER DEFAULT 0, gem_english INTEGER DEFAULT 0,
                gem_sst INTEGER DEFAULT 0, math_correct_lifetime INTEGER DEFAULT 0,
                science_correct_lifetime INTEGER DEFAULT 0,
                english_correct_lifetime INTEGER DEFAULT 0,
                sst_correct_lifetime INTEGER DEFAULT 0, unlocked_badges TEXT DEFAULT '[]'
            );

            CREATE TABLE IF NOT EXISTS auth_logs (
                id TEXT PRIMARY KEY, event_type TEXT NOT NULL, user_id TEXT,
                email TEXT, payload TEXT, status TEXT NOT NULL,
                error_message TEXT, created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_auth_logs_user_id ON auth_logs (user_id);

            CREATE TABLE IF NOT EXISTS report_logs (
                id TEXT PRIMARY KEY, user_id TEXT, sent_at TEXT NOT NULL,
                channel TEXT NOT NULL, recipient TEXT, trigger_type TEXT NOT NULL,
                status TEXT NOT NULL, error_message TEXT, message_sid TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_report_logs_user_id ON report_logs (user_id);

            CREATE TABLE IF NOT EXISTS sync_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_type TEXT NOT NULL,
                payload TEXT NOT NULL,
                created_at TEXT NOT NULL,
                synced_at TEXT,
                retry_count INTEGER DEFAULT 0,
                error TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_sync_logs_pending ON sync_logs (synced_at);
            CREATE INDEX IF NOT EXISTS idx_sync_logs_created_at ON sync_logs (created_at);
        `
    },

    // ── Append new migrations below. NEVER edit the ones above. ──────────────
    // {
    //   version: 2,
    //   description: 'Example: add theme column to profiles',
    //   sql: `ALTER TABLE profiles ADD COLUMN theme TEXT DEFAULT 'dark';`
    // },
];
