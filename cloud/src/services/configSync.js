import * as log from "../utils/logger.js";

const CODEX_PROMPT_URL = "https://raw.githubusercontent.com/decolua/9router/main/open-sse/config/codexInstructions.js";

/**
 * Sync system-wide prompts from remote source
 * @param {Object} env 
 */
export async function syncPrompts(env) {
    if (!env.KV) {
        log.warn("CONFIG_SYNC", "KV binding missing, skipping prompt sync");
        return;
    }

    try {
        log.info("CONFIG_SYNC", "Fetching latest Codex instructions...");
        const response = await fetch(CODEX_PROMPT_URL);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const content = await response.text();

        // Extract the string from the JS file (simple regex for our specific format)
        // Matches export const CODEX_DEFAULT_INSTRUCTIONS = `...`;
        const match = content.match(/export const CODEX_DEFAULT_INSTRUCTIONS = `([\s\S]*?)`;/);
        if (!match || !match[1]) {
            throw new Error("Could not parse CODEX_DEFAULT_INSTRUCTIONS from source");
        }

        const instructions = match[1].trim();

        // Save to KV with a long TTL (we sync via CRON anyway)
        await env.KV.put("SYSTEM_CONFIG:codex_instructions", instructions);

        log.info("CONFIG_SYNC", "Codex instructions updated successfully");
        return { success: true };
    } catch (error) {
        log.error("CONFIG_SYNC", `Failed to sync prompts: ${error.message}`);
        return { success: false, error: error.message };
    }
}
