/**
 * Offline Vault Service (Stub)
 */
export const vaultService = {
    async getVaultItems() {
        return [];
    },
    async unlockVaultItem(itemId) {
        return { success: true };
    }
};
