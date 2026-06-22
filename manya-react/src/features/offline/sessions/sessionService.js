/**
 * Offline Session Service (Stub)
 */
export const sessionService = {
    async startSession() {
        return { sessionId: 'stub' };
    },
    async endSession(sessionId) {
        return { success: true };
    }
};
