import { getMachineData } from "../services/storage.js";

/**
 * API Key utilities for Worker
 * Supports both formats:
 * - New: sk-{machineId}-{keyId}-{crc8}
 * - Old: sk-{random8}
 */

/**
 * Generate CRC (8-char HMAC) using Web Crypto API
 */
async function generateCrc(machineId, keyId, secret) {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret || "endpoint-proxy-api-key-secret");
  const data = encoder.encode(machineId + keyId);

  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", key, data);
  const hashArray = Array.from(new Uint8Array(signature));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");

  return hashHex.slice(0, 8);
}

/**
 * Parse API key and extract machineId + keyId
 * @param {string} apiKey
 * @param {string} secret
 * @returns {Promise<{ machineId: string, keyId: string, isNewFormat: boolean } | null>}
 */
export async function parseApiKey(apiKey, secret) {
  if (!apiKey || !apiKey.startsWith("sk-")) return null;

  const parts = apiKey.split("-");

  // New format: sk-{machineId}-{keyId}-{crc8} = 4 parts
  if (parts.length === 4) {
    const [, machineId, keyId, crc] = parts;

    // Verify CRC
    const expectedCrc = await generateCrc(machineId, keyId, secret);
    if (crc !== expectedCrc) return null;

    return { machineId, keyId, isNewFormat: true };
  }

  // Old format: sk-{random8} = 2 parts
  if (parts.length === 2) {
    return { machineId: null, keyId: parts[1], isNewFormat: false };
  }

  return null;
}

/**
 * Extract Bearer token from Authorization header
 * @param {Request} request
 * @returns {string | null}
 */
export function extractBearerToken(request) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  return authHeader.slice(7);
}

/**
 * Authenticate request and return machineId
 * @param {Request} request
 * @param {Object} env
 * @param {string|null} machineIdOverride - machineId from URL (optional)
 * @returns {Promise<{ machineId: string, apiKey: string } | { error: string, status: number }>}
 */
export async function authenticateRequest(request, env, machineIdOverride = null) {
  const apiKey = extractBearerToken(request);
  if (!apiKey) return { error: "Missing API key", status: 401 };

  let machineId = machineIdOverride;
  if (!machineId) {
    const parsed = await parseApiKey(apiKey, env.API_KEY_SECRET);
    if (!parsed) return { error: "Invalid API key format", status: 401 };

    if (!parsed.isNewFormat || !parsed.machineId) {
      return {
        error: "API key does not contain machineId. Use /{machineId}/v1/... endpoint for old format keys.",
        status: 400
      };
    }
    machineId = parsed.machineId;
  }

  const data = await getMachineData(machineId, env);
  const isValid = data?.apiKeys?.some(k => k.key === apiKey) || false;

  if (!isValid) return { error: "Invalid API key", status: 401 };

  return { machineId, apiKey };
}

