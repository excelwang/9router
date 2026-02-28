import { initTranslators } from "open-sse/translator/index.js";
import { ollamaModels } from "open-sse/config/ollamaModels.js";
import { transformToOllama } from "open-sse/utils/ollamaTransform.js";
import * as log from "./utils/logger.js";

// Static imports for handlers (avoid dynamic import CPU cost)
import { handleCleanup } from "./handlers/cleanup.js";
import { handleCacheClear } from "./handlers/cache.js";
import { handleSync } from "./handlers/sync.js";
import { handleChat } from "./handlers/chat.js";
import { handleVerify } from "./handlers/verify.js";
import { handleForward } from "./handlers/forward.js";
import { handleForwardRaw } from "./handlers/forwardRaw.js";
import { handleEmbeddings } from "./handlers/embeddings.js";
import { syncPrompts } from "./services/configSync.js";

// Neutral redirect target to hide identity
const REDIRECT_URL = "https://www.google.com";

// Initialize translators at module load (static imports)
initTranslators();

// Helper to add CORS headers to response
function addCorsHeaders(response) {
  const newHeaders = new Headers(response.headers);
  newHeaders.set("Access-Control-Allow-Origin", "*");
  newHeaders.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  newHeaders.set("Access-Control-Allow-Headers", "*");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders
  });
}

/**
 * Redirect unauthorized or illegal requests to hide identity
 */
function anonymizeResponse(response) {
  // Redirect 401 (Unauthorized), 403 (Forbidden), and 404 (Not Found)
  if ([401, 403, 404].includes(response.status)) {
    return new Response(null, {
      status: 302,
      headers: { "Location": REDIRECT_URL }
    });
  }
  return response;
}

const worker = {
  async scheduled(event, env, ctx) {
    // 1. Cleanup old data
    await handleCleanup(env);
    // 2. Sync system prompts
    await syncPrompts(env);

    log.info("SCHEDULED", "Routine tasks completed");
  },

  async fetch(request, env, ctx) {
    const startTime = Date.now();
    const url = new URL(request.url);
    let path = url.pathname;

    // Normalize /v1/v1/* → /v1/*
    if (path.startsWith("/v1/v1/")) {
      path = path.replace("/v1/v1/", "/v1/");
    } else if (path === "/v1/v1") {
      path = "/v1";
    }

    log.request(request.method, path);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "*"
        }
      });
    }

    try {
      // Routes

      // Landing page - Redirect instead of showing info
      if (path === "/" && request.method === "GET") {
        return anonymizeResponse(new Response(null, { status: 404 }));
      }

      if (path === "/health" && request.method === "GET") {
        log.response(200, Date.now() - startTime);
        return new Response(JSON.stringify({ status: "ok" }), {
          headers: { "Content-Type": "application/json" }
        });
      }

      // Diagnostics info (Colo, IP, Geography)
      if (path === "/v1/info" && request.method === "GET") {
        const cf = request.cf || {};
        const info = {
          colo: cf.colo || "Unknown",
          country: cf.country || "Unknown",
          city: cf.city || "Unknown",
          timezone: cf.timezone || "Unknown",
          continent: cf.continent || "Unknown",
          clientIp: request.headers.get("CF-Connecting-IP") || "Unknown",
          asOrganization: cf.asOrganization || "Unknown"
        };
        log.response(200, Date.now() - startTime);
        return new Response(JSON.stringify(info, null, 2), {
          headers: { "Content-Type": "application/json" }
        });
      }

      // Ollama compatible - list models
      if (path === "/api/tags" && request.method === "GET") {
        log.response(200, Date.now() - startTime);
        return new Response(JSON.stringify(ollamaModels), {
          headers: { "Content-Type": "application/json" }
        });
      }

      if (path === "/cache/clear" && request.method === "POST") {
        const response = await handleCacheClear(request, env);
        log.response(response.status, Date.now() - startTime);
        return response;
      }

      // Manual sync: prompts and other system config
      if (path === "/config/sync" && request.method === "POST") {
        const result = await syncPrompts(env);
        log.response(result.success ? 200 : 500, Date.now() - startTime);
        return new Response(JSON.stringify(result), {
          status: result.success ? 200 : 500,
          headers: { "Content-Type": "application/json" }
        });
      }

      // Sync provider data by machineId (GET, POST, DELETE)
      if (path.startsWith("/sync/") && ["GET", "POST", "DELETE"].includes(request.method)) {
        const response = await handleSync(request, env, ctx);
        log.response(response.status, Date.now() - startTime);
        return anonymizeResponse(response);
      }

      // ========== NEW FORMAT: /v1/... (machineId in API key) ==========

      // New format: /v1/chat/completions
      if (path === "/v1/chat/completions" && request.method === "POST") {
        const response = await handleChat(request, env, ctx, null);
        log.response(response.status, Date.now() - startTime);
        return anonymizeResponse(addCorsHeaders(response));
      }

      // New format: /v1/messages (Claude format)
      if (path === "/v1/messages" && request.method === "POST") {
        const response = await handleChat(request, env, ctx, null);
        log.response(response.status, Date.now() - startTime);
        return anonymizeResponse(addCorsHeaders(response));
      }

      // New format: /v1/embeddings
      if (path === "/v1/embeddings" && request.method === "POST") {
        const response = await handleEmbeddings(request, env, ctx, null);
        log.response(response.status, Date.now() - startTime);
        return anonymizeResponse(addCorsHeaders(response));
      }

      // New format: /v1/responses (OpenAI Responses API - Codex CLI)
      if (path === "/v1/responses" && request.method === "POST") {
        const response = await handleChat(request, env, ctx, null);
        log.response(response.status, Date.now() - startTime);
        return anonymizeResponse(response);
      }

      // New format: /v1/verify
      if (path === "/v1/verify" && request.method === "GET") {
        const response = await handleVerify(request, env, null);
        log.response(response.status, Date.now() - startTime);
        return anonymizeResponse(addCorsHeaders(response));
      }

      // New format: /v1/api/chat (Ollama format)
      if (path === "/v1/api/chat" && request.method === "POST") {
        const clonedReq = request.clone();
        const body = await clonedReq.json();
        const response = await handleChat(request, env, ctx, null);
        const ollamaResponse = transformToOllama(response, body.model || "llama3.2");
        log.response(200, Date.now() - startTime);
        return anonymizeResponse(ollamaResponse);
      }

      // ========== OLD FORMAT: /{machineId}/v1/... ==========

      // Machine ID based chat endpoint
      if (path.match(/^\/[^\/]+\/v1\/chat\/completions$/) && request.method === "POST") {
        const machineId = path.split("/")[1];
        const response = await handleChat(request, env, ctx, machineId);
        log.response(response.status, Date.now() - startTime);
        return anonymizeResponse(response);
      }

      // Machine ID based embeddings endpoint
      if (path.match(/^\/[^\/]+\/v1\/embeddings$/) && request.method === "POST") {
        const machineId = path.split("/")[1];
        const response = await handleEmbeddings(request, env, ctx, machineId);
        log.response(response.status, Date.now() - startTime);
        return anonymizeResponse(addCorsHeaders(response));
      }

      // Machine ID based messages endpoint (Claude format)
      if (path.match(/^\/[^\/]+\/v1\/messages$/) && request.method === "POST") {
        const machineId = path.split("/")[1];
        const response = await handleChat(request, env, ctx, machineId);
        log.response(response.status, Date.now() - startTime);
        return anonymizeResponse(response);
      }

      // Machine ID based api/chat endpoint (Ollama format)
      if (path.match(/^\/[^\/]+\/v1\/api\/chat$/) && request.method === "POST") {
        const machineId = path.split("/")[1];
        const clonedReq = request.clone();
        const body = await clonedReq.json();
        const response = await handleChat(request, env, ctx, machineId);
        const ollamaResponse = transformToOllama(response, body.model || "llama3.2");
        log.response(200, Date.now() - startTime);
        return anonymizeResponse(ollamaResponse);
      }

      // Machine ID based verify endpoint
      if (path.match(/^\/[^\/]+\/v1\/verify$/) && request.method === "GET") {
        const machineId = path.split("/")[1];
        const response = await handleVerify(request, env, machineId);
        log.response(response.status, Date.now() - startTime);
        return anonymizeResponse(response);
      }

      // Machine ID based forward endpoint
      if (path.match(/^\/[^\/]+\/forward$/) && request.method === "POST") {
        const machineId = path.split("/")[1];
        const response = await handleForward(request, env, machineId);
        log.response(response.status, Date.now() - startTime);
        return anonymizeResponse(response);
      }

      // Machine ID based forward-raw endpoint
      if (path.match(/^\/[^\/]+\/forward-raw$/) && request.method === "POST") {
        const machineId = path.split("/")[1];
        const response = await handleForwardRaw(request, env, machineId);
        log.response(response.status, Date.now() - startTime);
        return anonymizeResponse(response);
      }

      // Normal endpoints (no prefix)
      if (path === "/v1/chat/completions" && request.method === "POST") {
        const response = await handleChat(request, env, ctx);
        log.response(response.status, Date.now() - startTime);
        return anonymizeResponse(response);
      }

      if (path === "/v1/embeddings" && request.method === "POST") {
        const response = await handleEmbeddings(request, env);
        log.response(response.status, Date.now() - startTime);
        return anonymizeResponse(response);
      }

      if (path === "/forward" && request.method === "POST") {
        const response = await handleForward(request, env);
        log.response(response.status, Date.now() - startTime);
        return anonymizeResponse(response);
      }

      if (path === "/forward-raw" && request.method === "POST") {
        const response = await handleForwardRaw(request, env);
        log.response(response.status, Date.now() - startTime);
        return anonymizeResponse(response);
      }

      log.warn("ROUTER", "Not found", { path });
      return anonymizeResponse(new Response(JSON.stringify({ error: "Not Found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      }));

    } catch (error) {
      log.error("ROUTER", error.message, { stack: error.stack });
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  }
};

export default worker;

