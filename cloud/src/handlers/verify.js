import { authenticateRequest } from "../utils/apiKey.js";
import { getMachineData } from "../services/storage.js";

/**
 * Verify API key endpoint
 * @param {Request} request
 * @param {Object} env
 * @param {string|null} machineIdOverride - machineId from URL (old format) or null (new format)
 */
export async function handleVerify(request, env, machineIdOverride = null) {
  const auth = await authenticateRequest(request, env, machineIdOverride);

  if (auth.error) {
    return jsonResponse({ error: auth.error }, auth.status);
  }

  const machineId = auth.machineId;
  const data = await getMachineData(machineId, env);

  if (!data) {
    return jsonResponse({ error: "Machine not found" }, 404);
  }

  return jsonResponse({
    valid: true,
    machineId,
    providersCount: Object.keys(data.providers || {}).length
  });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

