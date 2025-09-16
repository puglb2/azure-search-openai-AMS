// api/chat/index.js
const fs = require("fs");
const path = require("path");

// Ensure fetch exists in this Node runtime (SWA Functions may vary)
if (typeof fetch === "undefined") {
  try { global.fetch = require("undici").fetch; } catch { /* no-op */ }
}

// ---------- load & cache instruction files ----------
let SYS_PROMPT = "";
let FAQ_SNIPPET = "";
let POLICIES_SNIPPET = "";

function readIfExists(p) { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } }

function initConfig() {
  if (SYS_PROMPT) return; // already loaded
  const cfgDir = path.join(__dirname, "../_config");
  SYS_PROMPT       = readIfExists(path.join(cfgDir, "system_prompt.txt")).trim();
  FAQ_SNIPPET      = readIfExists(path.join(cfgDir, "faqs.txt")).trim();
  POLICIES_SNIPPET = readIfExists(path.join(cfgDir, "policies.txt")).trim();

  if (FAQ_SNIPPET) {
    SYS_PROMPT += `

# FAQ (for quick reference; summarize when answering)
${FAQ_SNIPPET}`.trim();
  }
  if (POLICIES_SNIPPET) {
    SYS_PROMPT += `

# Policy notes (adhere to these)
${POLICIES_SNIPPET}`.trim();
  }
}

// ---------- HTTP helper with better diagnostics ----------
async function postJson(url, body, headers = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const ct = resp.headers.get("content-type") || "";
    const data = ct.includes("application/json")
      ? await resp.json().catch(() => ({}))
      : { text: await resp.text().catch(() => "") };
    return { resp, data };
  } finally {
    clearTimeout(id);
  }
}

// ---------- Build embeddings dependency ----------
function buildEmbeddingDependency(env) {
  const deploymentName = ((env.AZURE_EMBEDDINGS_DEPLOYMENT || "") + "").trim();
  if (deploymentName) {
    return { type: "deployment_name", deployment_name: deploymentName };
  }
  const endpoint = ((env.AZURE_EMBEDDINGS_ENDPOINT || "") + "").trim().replace(/\/+$/,"");
  const key      = ((env.AZURE_EMBEDDINGS_API_KEY || env.AZURE_OPENAI_API_KEY || "") + "").trim();
  if (endpoint && key) {
    return { type: "endpoint", endpoint, authentication: { type: "api_key", key } };
  }
  return undefined;
}

// ---------- Build OYD block if Search is configured ----------
function buildOydBlock(env, { safeMode }) {
  const endpoint = ((env.AZURE_SEARCH_ENDPOINT || "") + "").trim().replace(/\/+$/,"");
  const key      = ((env.AZURE_SEARCH_KEY || "") + "").trim();
  const index    = ((env.AZURE_SEARCH_INDEX || "") + "").trim();

  if (!endpoint || !key || !index) return undefined;

  let queryType = ((env.AZURE_SEARCH_QUERY_TYPE || "vector_semantic_hybrid") + "").trim();
  const semantic = ((env.AZURE_SEARCH_SEMANTIC_CONFIG || "") + "").trim();

  if (safeMode) {
    return {
      type: "azure_search",
      parameters: {
        endpoint, index_name: index,
        authentication: { type: "api_key", key },
        top_n_documents: 9,
        strictness: 3,
        query_type: "simple"
      }
    };
  }

  const isVectorMode = ["vector", "vector_simple_hybrid", "vector_semantic_hybrid"].includes(queryType);
  let embedding_dependency = undefined;
  if (isVectorMode) {
    embedding_dependency = buildEmbeddingDependency(env);
    if (!embedding_dependency) queryType = "simple"; // degrade if missing embeddings
  }

  const parameters = {
    endpoint, index_name: index,
    authentication: { type: "api_key", key },
    top_n_documents: 9,
    strictness: 3,
    query_type: queryType
  };

  if (semantic && (queryType === "semantic" || queryType === "vector_semantic_hybrid")) {
    parameters.semantic_configuration = semantic;
  }
  if (embedding_dependency) {
    parameters.embedding_dependency = embedding_dependency;
  }

  // Adjust to your schema if needed
  parameters.fields_mapping = {
    content_fields: ["content", "chunk", "page_content"],
    title_field: "title",
    filepath_field: "source",
    url_field: "url"
  };
  parameters.include_contexts = ["citations", "intent"];

  return { type: "azure_search", parameters };
}

// ---------- Helpers to juggle token param names ----------
function buildRequestBody(messages, temp, tokens, oydBlock, useMaxCompletionTokens) {
  const body = { messages, temperature: temp };
  if (useMaxCompletionTokens) {
    body.max_completion_tokens = tokens;
  } else {
    body.max_tokens = tokens;
  }
  if (oydBlock) body.data_sources = [oydBlock];
  return body;
}
function extractErrorMessage(data) {
  if (!data) return "";
  if (typeof data === "string") return data;
  const s = data.error?.message || data.message || data.text || "";
  return typeof s === "string" ? s : JSON.stringify(s);
}
function shouldRetryWithOppositeParam(resp, data, triedMCT) {
  if (resp.status !== 400) return false;
  const msg = extractErrorMessage(data).toLowerCase();
  if (!triedMCT && (msg.includes("unsupported parameter") && msg.includes("max_tokens"))) return true;
  if (triedMCT && (msg.includes("extra inputs are not permitted") && msg.includes("max_completion_tokens"))) return true;
  return false;
}

module.exports = async function (context, req) {
  try {
    initConfig();

    const userMessage = (req.body?.message || "").toString().trim();
    if (!userMessage) {
      context.res = { status: 400, headers: { "Content-Type":"application/json" }, body: { error: "message required" } };
      return;
    }

    // ---- Env vars (safe reads) ----
    const apiVersion = ((process.env.AZURE_OPENAI_API_VERSION || "2024-10-21") + "").trim();
    const endpoint   = ((process.env.AZURE_OPENAI_ENDPOINT || "") + "").trim().replace(/\/+$/,"");
    const deployment = ((process.env.AZURE_OPENAI_DEPLOYMENT || "") + "").trim();
    const apiKey     = ((process.env.AZURE_OPENAI_API_KEY || "") + "").trim();

    if (!endpoint || !deployment || !apiKey) {
      context.res = { status: 200, headers: { "Content-Type":"application/json" }, body: { reply: "Hello! (Model not configured yet.)" } };
      return;
    }

    const oydEnabled = String(process.env.AZURE_OYD_ENABLED || "1") !== "0";
    const safeMode   = String(process.env.AZURE_SEARCH_SAFE_MODE || "0") === "1";
    const oydBlock   = oydEnabled ? buildOydBlock(process.env, { safeMode }) : undefined;

    const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;

    const baseMessages = [
      { role: "system", content: SYS_PROMPT || "You are a helpful intake assistant." },
      { role: "user",   content: userMessage }
    ];

    // Token param strategy: auto-switch based on error
    const forceMCT = String(process.env.AZURE_USE_MAX_COMPLETION_TOKENS || "auto").toLowerCase();
    let tryMCTFirst = forceMCT === "1" || forceMCT === "true";
    let tokens = 600;
    let temp   = 1;

    // First attempt
    let body1 = buildRequestBody(baseMessages, temp, tokens, oydBlock, tryMCTFirst);
    let { resp, data } = await postJson(url, body1, { "api-key": apiKey });

    // If 400 due to token param name, retry with the opposite param
    if (!resp.ok && shouldRetryWithOppositeParam(resp, data, tryMCTFirst)) {
      const body2 = buildRequestBody(baseMessages, temp, tokens, oydBlock, !tryMCTFirst);
      const second = await postJson(url, body2, { "api-key": apiKey });
      resp = second.resp; data = second.data;
      tryMCTFirst = !tryMCTFirst; // remember which one worked for subsequent calls in this execution
    }

    if (resp.ok) {
      const choice = data?.choices?.[0];
      let reply = (choice?.message?.content || "").trim();

      // Optional retry if filtered/empty
      const filtered = choice?.finish_reason === "content_filter" ||
        (Array.isArray(data?.prompt_filter_results) && data.prompt_filter_results.some(r => {
          const cfr = r?.content_filter_results;
          return cfr && Object.values(cfr).some(v => v?.filtered);
        }));

      if ((!reply || filtered) && !req.query?.debug) {
        const nudged = [
          baseMessages[0],
          { role: "user", content: "Instruction: Respond in plain text (1–2 sentences). Do not call tools." },
          baseMessages[1]
        ];
        const nTokens = 400;
        const nudgedBody = buildRequestBody(nudged, temp, nTokens, oydBlock, tryMCTFirst);
        const second = await postJson(url, nudgedBody, { "api-key": apiKey });
        if (second.resp.ok) {
          const c2 = second.data?.choices?.[0];
          reply = (c2?.message?.content || reply || "").trim();
        }
      }

      if (req.query?.debug === "1") {
        context.res = {
          status: 200,
          headers: { "Content-Type":"application/json" },
          body: {
            reply: reply || "",
            usage: data?.usage,
            finish_reason: data?.choices?.[0]?.finish_reason,
            had_oyd: !!oydBlock,
            api_version: apiVersion,
            used_max_completion_tokens: tryMCTFirst
          }
        };
        return;
      }

      context.res = { status: 200, headers: {"Content-Type":"application/json"}, body: { reply: reply || "" } };
      return;
    }

    // Non-2xx: surface the actual upstream status & details
    context.res = {
      status: resp.status,
      headers: { "Content-Type":"application/json" },
      body: {
        error: "Upstream Azure OpenAI error",
        upstream_status: resp.status,
        detail: data,
        env_check: {
          has_OPENAI_ENDPOINT: !!endpoint,
          has_OPENAI_DEPLOYMENT: !!deployment,
          has_OPENAI_API_VERSION: !!apiVersion,
          has_SEARCH_ENDPOINT: !!process.env.AZURE_SEARCH_ENDPOINT,
          has_SEARCH_INDEX: !!process.env.AZURE_SEARCH_INDEX,
          has_SEARCH_KEY: !!process.env.AZURE_SEARCH_KEY,
          oyd_enabled: !!oydBlock,
          safe_mode: safeMode
        }
      }
    };
  } catch (e) {
    context.res = {
      status: 500,
      headers: { "Content-Type":"application/json" },
      body: {
        error: "server error",
        detail: String(e),
        note: "Check SWA → Functions → Log stream for stack trace."
      }
    };
  }
};
