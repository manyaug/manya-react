/**
 * Answer Service — OFFLINE-FIRST
 * ================================
 * @offline-first  Answering questions never requires connectivity.
 *
 * Flow:
 *   1. Write answer to user_answers (user.db) immediately.
 *   2. Write balance change to user_transactions (user.db).
 *   3. Update user_balances optimistically (local mirror).
 *   4. Update concept_mastery (user.db).
 *   5. Queue sync events in sync_logs.
 *   6. Return success — UI updates instantly.
 *
 * No Supabase calls. No network wait. Pure local writes.
 */

// @offline-first
import { dbUpsert, dbExecute, dbQuery } from '../../backend/bridge/manyaBridge.js';
import { queueSyncEvent } from '../../backend/sync/syncService.js';
import { randomUUID } from '../../utils/uuid.js';

/**
 * Record a question answer and update all related local state.
 * The canonical source of truth remains Supabase — this is an optimistic write.
 *
 * @param {{
 *   userId: string,
 *   questionId: string,
 *   sessionId: string,
 *   subject: string,
 *   isCorrect: boolean,
 *   selectedAnswer: string,
 *   correctAnswer: string,
 *   timeSpentMs: number,
 *   hintUsed: boolean,
 *   pointsEarned: number,
 *   coinsDelta: number,
 *   gemsDelta: number,
 *   questId?: string,
 *   conceptBaseId?: string,
 * }} answerData
 * @returns {Promise<{ success: boolean, newBalances: object }>}
 */
export async function recordAnswer(answerData) {
    const {
        userId, questionId, sessionId, subject, isCorrect,
        selectedAnswer, correctAnswer, timeSpentMs, hintUsed,
        pointsEarned, coinsDelta, gemsDelta,
        questId, conceptBaseId
    } = answerData;

    const answerId = randomUUID();
    const now = new Date().toISOString();

    // ── 1. Write to user_answers ──────────────────────────────────────────────
    await dbUpsert('user', 'user_answers', {
        id:              answerId,
        user_id:         userId,
        question_id:     questionId,
        session_id:      sessionId,
        is_correct:      isCorrect ? 1 : 0,
        selected_answer: selectedAnswer,
        correct_answer:  correctAnswer,
        time_spent_ms:   timeSpentMs,
        hint_used:       hintUsed ? 1 : 0,
        points_earned:   pointsEarned,
        quest_id:        questId ?? null,
        answered_at:     now,
        client_timestamp: now,
        synced:          0
    });

    // ── 2. Record balance transaction in ledger ───────────────────────────────
    if (coinsDelta !== 0) {
        await dbUpsert('user', 'user_transactions', {
            id:               randomUUID(),
            user_id:          userId,
            currency:         'coins',
            amount_change:    coinsDelta,
            transaction_type: isCorrect ? 'ANSWER_CORRECT' : 'ANSWER_INCORRECT',
            context_id:       answerId,
            created_at:       now
        });
    }

    const gemColumn = `gem_${subject.toLowerCase()}`;
    if (gemsDelta !== 0) {
        await dbUpsert('user', 'user_transactions', {
            id:               randomUUID(),
            user_id:          userId,
            currency:         gemColumn,
            amount_change:    gemsDelta,
            transaction_type: isCorrect ? 'ANSWER_CORRECT' : 'ANSWER_INCORRECT',
            context_id:       answerId,
            created_at:       now
        });
    }

    // ── 3. Optimistically update user_balances ────────────────────────────────
    // WARNING: These values will be OVERWRITTEN by server canonical on next sync.
    await dbExecute('user',
        `UPDATE user_balances
         SET coins = coins + ?, ${gemColumn} = ${gemColumn} + ?, updated_at = ?
         WHERE user_id = ?`,
        [coinsDelta, gemsDelta, now, userId]
    );

    // ── 4. Update concept_mastery ─────────────────────────────────────────────
    if (conceptBaseId) {
        await updateConceptMastery({ userId, subject, baseId: conceptBaseId, isCorrect, now });
    }

    // ── 5. Queue sync events ──────────────────────────────────────────────────
    await queueSyncEvent('ANSWER_SUBMITTED', {
        answer_id:        answerId,
        user_id:          userId,
        question_id:      questionId,
        session_id:       sessionId,
        subject:          subject,
        is_correct:       isCorrect,
        time_spent_ms:    timeSpentMs,
        hint_used:        hintUsed,
        points_earned:    pointsEarned,
        coins_delta:      coinsDelta,
        gems_delta:       gemsDelta,
        quest_id:         questId ?? null,
        concept_base_id:  conceptBaseId ?? null,
        answered_at:      now
    });

    // ── 6. Read fresh local balances for UI update ────────────────────────────
    const balanceRows = await dbQuery('user', 'user_balances', { user_id: userId }, { limit: 1 });
    return { success: true, newBalances: balanceRows?.[0] ?? null };
}

// ── Concept Mastery Update (private) ─────────────────────────────────────────

async function updateConceptMastery({ userId, subject, baseId, isCorrect, now }) {
    const masteryId = `${userId}::${subject}::${baseId}`;
    const existing = await dbQuery('user', 'concept_mastery',
        { user_id: userId, subject, base_id: baseId }, { limit: 1 });
    const current = existing?.[0];

    const totalAttempts  = (current?.total_attempts ?? 0) + 1;
    const totalCorrect   = (current?.total_correct ?? 0) + (isCorrect ? 1 : 0);
    const correctStreak  = isCorrect ? (current?.correct_streak ?? 0) + 1 : 0;
    const reviewCount    = (current?.review_count ?? 0) + 1;

    // Mastery progression: new → learning → practiced → mastered
    const THRESHOLDS = { new: 0, learning: 3, practiced: 8, mastered: 15 };
    let masteryLevel = current?.mastery_level ?? 'new';
    if (totalCorrect >= THRESHOLDS.mastered) masteryLevel = 'mastered';
    else if (totalCorrect >= THRESHOLDS.practiced) masteryLevel = 'practiced';
    else if (totalCorrect >= THRESHOLDS.learning) masteryLevel = 'learning';

    // Next review interval (spaced repetition: simple)
    const INTERVALS_MS = { new: 1, learning: 1, practiced: 3, mastered: 7 };
    const nextReviewDays = INTERVALS_MS[masteryLevel] ?? 1;
    const nextReviewAt = new Date(Date.now() + nextReviewDays * 86400000).toISOString();

    await dbUpsert('user', 'concept_mastery', {
        id:               masteryId,
        user_id:          userId,
        subject:          subject,
        base_id:          baseId,
        mastery_level:    masteryLevel,
        correct_streak:   correctStreak,
        total_attempts:   totalAttempts,
        total_correct:    totalCorrect,
        next_review_at:   nextReviewAt,
        updated_at:       now,
        review_count:     reviewCount,
        last_reviewed_at: now
    });

    // Queue mastery update for sync
    await queueSyncEvent('MASTERY_UPDATED', {
        user_id:       userId,
        subject:       subject,
        base_id:       baseId,
        mastery_level: masteryLevel,
        new_score:     totalCorrect,
        updated_at:    now
    });
}
